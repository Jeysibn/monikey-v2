import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Pool } from "pg";
import fc from "fast-check";
import {
  archiveFinancialAccount,
  createFinancialAccount,
  readFinancialAccount,
} from "./accounts.js";
import {
  createAdjustment,
  createCardPayment,
  deleteTransaction,
  editIncomeOrExpense,
  createIncomeOrExpense,
  createRefund,
  createTransfer,
  readTransactionAudit,
  TransactionConflictError,
  TransactionNotFoundError,
} from "./transactions.js";
import { listTransactions } from "./transactions.js";
import { ensureDefaultCategories } from "./categories.js";
import { runIdempotently } from "./idempotency.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";
import { readMonthlyReport } from "./reports.js";

const databaseUrl = requireDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test("income and expense commands post balanced journals and derive balances", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    const otherOwner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'owner@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    assert.ok(otherOwner.rows[0]?.id);
    const userId = owner.rows[0]!.id;

    const account = await createFinancialAccount(
      client,
      userId,
      {
        type: "BANK",
        name: "Transaction bank",
        openingBalanceMinor: "1000000",
      },
      "2026-10-22",
    );
    await createFinancialAccount(
      client,
      otherOwner.rows[0]!.id,
      {
        type: "BANK",
        name: "Other transaction bank",
        openingBalanceMinor: "0",
      },
      "2026-10-22",
    );
    const categories = await client.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM categories
        WHERE user_id = $1 AND name IN ('Food', 'Salary')
        ORDER BY kind`,
      [userId],
    );
    assert.equal(categories.rowCount, 2);
    const expenseCategory = categories.rows.find(
      (row) => row.kind === "EXPENSE",
    );
    const incomeCategory = categories.rows.find((row) => row.kind === "INCOME");
    assert.ok(expenseCategory?.id);
    assert.ok(incomeCategory?.id);

    const expense = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: account.id,
        categoryId: expenseCategory.id,
        amountMinor: "25000",
        occurredOn: "2026-10-22",
        note: "Lunch",
      },
      "2026-10-22",
    );
    assert.equal(expense.transaction.kind, "EXPENSE");
    assert.equal(expense.account.balanceMinor, "975000");

    const income = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "INCOME",
        sourceAccountId: account.id,
        categoryId: incomeCategory.id,
        amountMinor: "400000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(income.transaction.kind, "INCOME");
    assert.equal(income.account.balanceMinor, "1375000");

    const journals = await client.query<{
      operation_kind: string;
      posting_count: string;
      debit_total: string;
      credit_total: string;
    }>(
      `SELECT j.operation_kind,
              count(p.id)::text AS posting_count,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'DEBIT')::text AS debit_total,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'CREDIT')::text AS credit_total
         FROM journals j
         JOIN postings p ON p.user_id = j.user_id AND p.journal_id = j.id
        WHERE j.user_id = $1 AND j.transaction_id IN ($2, $3)
        GROUP BY j.id, j.operation_kind
        ORDER BY j.operation_kind`,
      [userId, expense.transaction.id, income.transaction.id],
    );
    assert.deepEqual(journals.rows, [
      {
        operation_kind: "EXPENSE",
        posting_count: "2",
        debit_total: "25000",
        credit_total: "25000",
      },
      {
        operation_kind: "INCOME",
        posting_count: "2",
        debit_total: "400000",
        credit_total: "400000",
      },
    ]);

    await assert.rejects(
      createIncomeOrExpense(
        client,
        userId,
        {
          kind: "INCOME",
          sourceAccountId: account.id,
          categoryId: expenseCategory.id,
          amountMinor: "1",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      TransactionConflictError,
    );

    await assert.rejects(
      createIncomeOrExpense(
        client,
        userId,
        {
          kind: "EXPENSE",
          sourceAccountId: account.id,
          categoryId: expenseCategory.id,
          amountMinor: "2259999",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      TransactionConflictError,
    );
    const negative = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: account.id,
        categoryId: expenseCategory.id,
        amountMinor: "2259999",
        occurredOn: "2026-10-22",
        acknowledgeNegativeBalance: true,
      },
      "2026-10-22",
    );
    assert.equal(negative.account.balanceMinor, "-884999");

    await assert.rejects(
      createIncomeOrExpense(
        client,
        userId,
        {
          kind: "EXPENSE",
          sourceAccountId: account.id,
          categoryId: expenseCategory.id,
          amountMinor: "1",
          occurredOn: "2026-10-23",
        },
        "2026-10-22",
      ),
      /future date/,
    );
    await assert.rejects(
      createIncomeOrExpense(
        client,
        userId,
        {
          kind: "EXPENSE",
          sourceAccountId: account.id,
          categoryId: expenseCategory.id,
          amountMinor: "1",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      /negative/,
    );

    const foreignCategory = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' LIMIT 1`,
      [otherOwner.rows[0]!.id],
    );
    assert.ok(foreignCategory.rows[0]?.id);
    await assert.rejects(
      createIncomeOrExpense(
        client,
        userId,
        {
          kind: "EXPENSE",
          sourceAccountId: account.id,
          categoryId: foreignCategory.rows[0]!.id,
          amountMinor: "1",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      TransactionNotFoundError,
    );

    const reread = await readFinancialAccount(client, userId, account.id);
    assert.equal(reread.balanceMinor, "-884999");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("activity cursor preserves PostgreSQL timestamp precision for tied entries", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;
    await ensureDefaultCategories(client, userId);
    const account = await createFinancialAccount(
      client,
      userId,
      {
        type: "BANK",
        name: "Activity cursor bank",
        openingBalanceMinor: "1000",
      },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food'`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);
    const expected = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      const created = await createIncomeOrExpense(
        client,
        userId,
        {
          kind: "EXPENSE",
          sourceAccountId: account.id,
          categoryId: category.rows[0]!.id,
          amountMinor: "1",
          occurredOn: "2026-10-22",
          note: `Tied activity ${index}`,
        },
        "2026-10-22",
      );
      expected.add(created.transaction.id);
    }

    const actual = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listTransactions(client, userId, {
        limit: 1,
        kind: "EXPENSE",
        cursor,
      });
      for (const item of page.activity) actual.add(item.transaction.id);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && actual.size < 10);

    assert.deepEqual(actual, expected);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("randomized posting references reject archived, foreign, and missing resources", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owners = await client.query<{ owner: string; other: string }>(
      `SELECT
         (SELECT id FROM users WHERE email_normalized = 'second@example.test') AS owner,
         (SELECT id FROM users WHERE email_normalized = 'owner@example.test') AS other`,
    );
    const ownerId = owners.rows[0]?.owner;
    const otherOwnerId = owners.rows[0]?.other;
    assert.ok(ownerId);
    assert.ok(otherOwnerId);

    const activeAccount = await createFinancialAccount(
      client,
      ownerId,
      {
        type: "CASH",
        name: "Posting reference active",
        openingBalanceMinor: "1000",
      },
      "2026-10-23",
    );
    const archivedAccount = await createFinancialAccount(
      client,
      ownerId,
      {
        type: "BANK",
        name: "Posting reference archived",
        openingBalanceMinor: "1000",
      },
      "2026-10-23",
    );
    const foreignAccount = await createFinancialAccount(
      client,
      otherOwnerId,
      {
        type: "CASH",
        name: "Posting reference foreign",
        openingBalanceMinor: "1000",
      },
      "2026-10-23",
    );
    const categories = await client.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND kind = 'EXPENSE' ORDER BY name LIMIT 1`,
      [ownerId],
    );
    const activeCategory = categories.rows[0]?.id;
    assert.ok(activeCategory);
    const foreignCategory = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' ORDER BY name LIMIT 1`,
      [otherOwnerId],
    );
    assert.ok(foreignCategory.rows[0]?.id);
    const archivedCategory = await client.query<{ id: string }>(
      `INSERT INTO categories (user_id, kind, name, sort_order)
       VALUES ($1, 'EXPENSE', 'Posting reference archived', 100)
       RETURNING id`,
      [ownerId],
    );
    assert.ok(archivedCategory.rows[0]?.id);
    await client.query(
      `UPDATE categories SET archived_at = now()
        WHERE user_id = $1 AND id = $2`,
      [ownerId, archivedCategory.rows[0]!.id],
    );
    await archiveFinancialAccount(client, ownerId, archivedAccount.id);

    const invalidAccounts = [
      foreignAccount.id,
      archivedAccount.id,
      randomUUID(),
    ];
    const invalidCategories = [
      foreignCategory.rows[0]!.id,
      archivedCategory.rows[0]!.id,
      randomUUID(),
    ];
    const requestFor = (sourceAccountId: string, categoryId: string) => ({
      kind: "EXPENSE" as const,
      sourceAccountId,
      categoryId,
      amountMinor: "1",
      occurredOn: "2026-10-23",
    });

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...invalidAccounts),
        async (sourceAccountId) => {
          await assert.rejects(
            createIncomeOrExpense(
              client,
              ownerId,
              requestFor(sourceAccountId, activeCategory),
              "2026-10-23",
            ),
            TransactionNotFoundError,
          );
        },
      ),
      { numRuns: 30 },
    );
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...invalidCategories),
        async (categoryId) => {
          await assert.rejects(
            createIncomeOrExpense(
              client,
              ownerId,
              requestFor(activeAccount.id, categoryId),
              "2026-10-23",
            ),
            TransactionNotFoundError,
          );
        },
      ),
      { numRuns: 30 },
    );

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("transfer commands move balances and post optional fees as spending", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;
    const source = await createFinancialAccount(
      client,
      userId,
      {
        type: "BANK",
        name: "Transfer source",
        openingBalanceMinor: "1000000",
      },
      "2026-10-22",
    );
    const destination = await createFinancialAccount(
      client,
      userId,
      {
        type: "EWALLET",
        name: "Transfer destination",
        openingBalanceMinor: "0",
      },
      "2026-10-22",
    );
    const categories = await client.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM categories
        WHERE user_id = $1 AND name = 'Food'`,
      [userId],
    );
    const feeCategory = categories.rows.find((row) => row.kind === "EXPENSE");
    assert.ok(feeCategory?.id);

    const totalsBeforeTransfer = await readMonthlyReport(
      client,
      userId,
      "2026-10",
    );
    const moved = await createTransfer(
      client,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountMinor: "100000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(moved.sourceAccount.balanceMinor, "900000");
    assert.equal(moved.destinationAccount.balanceMinor, "100000");
    const totalsAfterTransfer = await readMonthlyReport(
      client,
      userId,
      "2026-10",
    );
    assert.deepEqual(
      {
        incomeMinor: totalsAfterTransfer.incomeMinor,
        netExpensesMinor: totalsAfterTransfer.netExpensesMinor,
        netCashFlowMinor: totalsAfterTransfer.netCashFlowMinor,
      },
      {
        incomeMinor: totalsBeforeTransfer.incomeMinor,
        netExpensesMinor: totalsBeforeTransfer.netExpensesMinor,
        netCashFlowMinor: totalsBeforeTransfer.netCashFlowMinor,
      },
    );

    const withFee = await createTransfer(
      client,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountMinor: "100000",
        feeMinor: "1500",
        feeCategoryId: feeCategory.id,
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(withFee.sourceAccount.balanceMinor, "798500");
    assert.equal(withFee.destinationAccount.balanceMinor, "200000");

    const journal = await client.query<{
      operation_kind: string;
      posting_count: string;
      debit_total: string;
      credit_total: string;
    }>(
      `SELECT j.operation_kind,
              count(p.id)::text AS posting_count,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'DEBIT')::text AS debit_total,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'CREDIT')::text AS credit_total
         FROM journals j
         JOIN postings p ON p.user_id = j.user_id AND p.journal_id = j.id
        WHERE j.user_id = $1 AND j.transaction_id = $2
        GROUP BY j.id, j.operation_kind`,
      [userId, withFee.transaction.id],
    );
    assert.deepEqual(journal.rows, [
      {
        operation_kind: "TRANSFER",
        posting_count: "3",
        debit_total: "101500",
        credit_total: "101500",
      },
    ]);
    const totalsAfterFeeTransfer = await readMonthlyReport(
      client,
      userId,
      "2026-10",
    );
    assert.equal(totalsAfterFeeTransfer.incomeMinor, "0");
    assert.equal(totalsAfterFeeTransfer.netExpensesMinor, "1500");

    const originalExpense = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: source.id,
        categoryId: feeCategory.id,
        amountMinor: "15000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(originalExpense.account.balanceMinor, "783500");
    const refund = await createRefund(
      client,
      userId,
      {
        kind: "REFUND",
        sourceAccountId: destination.id,
        refundedTransactionId: originalExpense.transaction.id,
        amountMinor: "10000",
        occurredOn: "2026-10-22",
        note: "Merchant refund",
      },
      "2026-10-22",
    );
    assert.equal(refund.transaction.categoryId, feeCategory.id);
    assert.equal(
      refund.transaction.refundedTransactionId,
      originalExpense.transaction.id,
    );
    assert.equal(refund.account.balanceMinor, "210000");

    const alternateExpenseCategory = await client.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND kind = 'EXPENSE' AND id <> $2
        ORDER BY name
        LIMIT 1`,
      [userId, feeCategory.id],
    );
    assert.ok(alternateExpenseCategory.rows[0]?.id);

    const refundHistoryBeforeMutation = await client.query<{
      journals: string;
      revisions: string;
    }>(
      `SELECT
         (SELECT count(*) FROM journals
           WHERE user_id = $1 AND transaction_id IN ($2, $3))::text AS journals,
         (SELECT count(*) FROM transaction_revisions
           WHERE user_id = $1 AND transaction_id IN ($2, $3))::text AS revisions`,
      [userId, originalExpense.transaction.id, refund.transaction.id],
    );

    await assert.rejects(
      editIncomeOrExpense(
        client,
        userId,
        originalExpense.transaction.id,
        {
          kind: "EXPENSE",
          sourceAccountId: source.id,
          categoryId: feeCategory.id,
          amountMinor: "5000",
          occurredOn: "2026-10-22",
          reason: "Lower than the linked refund",
        },
        "2026-10-22",
      ),
      TransactionConflictError,
    );
    await assert.rejects(
      editIncomeOrExpense(
        client,
        userId,
        originalExpense.transaction.id,
        {
          kind: "EXPENSE",
          sourceAccountId: source.id,
          categoryId: alternateExpenseCategory.rows[0]!.id,
          amountMinor: "15000",
          occurredOn: "2026-10-22",
          reason: "Move linked expense category",
        },
        "2026-10-22",
      ),
      TransactionConflictError,
    );
    await assert.rejects(
      deleteTransaction(
        client,
        userId,
        originalExpense.transaction.id,
        {
          reason: "Void expense with a posted refund",
        },
        "2026-10-24",
      ),
      TransactionConflictError,
    );

    const refundHistoryAfterMutation = await client.query<{
      journals: string;
      revisions: string;
    }>(
      `SELECT
         (SELECT count(*) FROM journals
           WHERE user_id = $1 AND transaction_id IN ($2, $3))::text AS journals,
         (SELECT count(*) FROM transaction_revisions
           WHERE user_id = $1 AND transaction_id IN ($2, $3))::text AS revisions`,
      [userId, originalExpense.transaction.id, refund.transaction.id],
    );
    assert.deepEqual(
      refundHistoryAfterMutation.rows,
      refundHistoryBeforeMutation.rows,
    );

    const increased = await createAdjustment(
      client,
      userId,
      {
        kind: "ADJUSTMENT",
        accountId: source.id,
        direction: "INCREASE",
        amountMinor: "500",
        occurredOn: "2026-10-22",
        note: "Cash count correction",
      },
      "2026-10-22",
    );
    assert.equal(increased.account.balanceMinor, "784000");
    const decreased = await createAdjustment(
      client,
      userId,
      {
        kind: "ADJUSTMENT",
        accountId: source.id,
        direction: "DECREASE",
        amountMinor: "1000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(decreased.account.balanceMinor, "783000");
    await assert.rejects(
      createAdjustment(
        client,
        userId,
        {
          kind: "ADJUSTMENT",
          accountId: source.id,
          direction: "DECREASE",
          amountMinor: "999999",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      /negative/,
    );

    await assert.rejects(
      createTransfer(
        client,
        userId,
        {
          kind: "TRANSFER",
          fromAccountId: source.id,
          toAccountId: source.id,
          amountMinor: "1",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      TransactionConflictError,
    );
    await assert.rejects(
      createTransfer(
        client,
        userId,
        {
          kind: "TRANSFER",
          fromAccountId: source.id,
          toAccountId: destination.id,
          amountMinor: "999999",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      /negative/,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("opposite-direction transfers serialize without deadlock or balance drift", async () => {
  const setupClient = await pool.connect();
  let sourceId: string;
  let destinationId: string;
  let userId: string;
  try {
    await setupClient.query("BEGIN");
    const owner = await setupClient.query<{ id: string }>(
      `INSERT INTO users (email_normalized, password_hash)
       SELECT 'concurrency@example.test', password_hash
         FROM users
        WHERE email_normalized = 'second@example.test'
       ON CONFLICT (email_normalized)
       DO UPDATE SET email_normalized = EXCLUDED.email_normalized
       RETURNING id`,
    );
    assert.ok(owner.rows[0]?.id);
    userId = owner.rows[0]!.id;
    await setupClient.query(
      `INSERT INTO user_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    const existingAccounts = await setupClient.query<{
      id: string;
      name: string;
    }>(
      `SELECT id, name FROM financial_accounts
        WHERE user_id = $1
          AND name IN ('Concurrent transfer source', 'Concurrent transfer destination')`,
      [userId],
    );
    const accountByName = new Map(
      existingAccounts.rows.map((account) => [account.name, account.id]),
    );
    if (!accountByName.has("Concurrent transfer source")) {
      const source = await createFinancialAccount(
        setupClient,
        userId,
        {
          type: "BANK",
          name: "Concurrent transfer source",
          openingBalanceMinor: "100000",
        },
        "2026-10-22",
      );
      accountByName.set(source.name, source.id);
    }
    if (!accountByName.has("Concurrent transfer destination")) {
      const destination = await createFinancialAccount(
        setupClient,
        userId,
        {
          type: "EWALLET",
          name: "Concurrent transfer destination",
          openingBalanceMinor: "100000",
        },
        "2026-10-22",
      );
      accountByName.set(destination.name, destination.id);
    }
    sourceId = accountByName.get("Concurrent transfer source")!;
    destinationId = accountByName.get("Concurrent transfer destination")!;
    await setupClient.query("COMMIT");
  } finally {
    await setupClient.query("ROLLBACK").catch(() => undefined);
    setupClient.release();
  }

  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  let successfulTransferIds: string[];
  try {
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    await firstClient.query("SET LOCAL lock_timeout = '3000ms'");
    await secondClient.query("SET LOCAL lock_timeout = '3000ms'");

    const firstTransferPromise = createTransfer(
      firstClient,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: sourceId,
        toAccountId: destinationId,
        amountMinor: "10000",
        occurredOn: "2026-10-22",
        note: "Concurrent transfer source to destination",
      },
      "2026-10-22",
    ).then(async (result) => {
      await firstClient.query("COMMIT");
      return result;
    });
    const secondTransferPromise = createTransfer(
      secondClient,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: destinationId,
        toAccountId: sourceId,
        amountMinor: "10000",
        occurredOn: "2026-10-22",
        note: "Concurrent transfer destination to source",
      },
      "2026-10-22",
    ).then(async (result) => {
      await secondClient.query("COMMIT");
      return result;
    });
    const transferResults = await Promise.allSettled([
      firstTransferPromise,
      secondTransferPromise,
    ]);
    const successfulTransfers = [];
    for (const result of transferResults) {
      if (result.status === "rejected") throw result.reason;
      successfulTransfers.push(result.value);
    }
    assert.notEqual(
      successfulTransfers[0]!.transaction.id,
      successfulTransfers[1]!.transaction.id,
    );
    successfulTransferIds = successfulTransfers.map(
      (transfer) => transfer.transaction.id,
    );
  } finally {
    await firstClient.query("ROLLBACK").catch(() => undefined);
    await secondClient.query("ROLLBACK").catch(() => undefined);
    firstClient.release();
    secondClient.release();
  }

  const verifyClient = await pool.connect();
  try {
    const balances = await verifyClient.query<{
      name: string;
      balance: string;
    }>(
      `SELECT a.name,
              COALESCE(sum(
                CASE
                  WHEN p.direction = 'DEBIT' THEN p.amount_minor
                  ELSE -p.amount_minor
                END
              ), 0)::text AS balance
         FROM financial_accounts a
         JOIN ledger_accounts la
           ON la.user_id = a.user_id AND la.financial_account_id = a.id
         LEFT JOIN postings p
           ON p.user_id = la.user_id AND p.ledger_account_id = la.id
        WHERE a.user_id = $1 AND a.id IN ($2, $3)
        GROUP BY a.id, a.name
        ORDER BY a.name`,
      [userId, sourceId, destinationId],
    );
    assert.deepEqual(balances.rows, [
      { name: "Concurrent transfer destination", balance: "100000" },
      { name: "Concurrent transfer source", balance: "100000" },
    ]);

    const journals = await verifyClient.query<{
      posting_count: string;
      debit_total: string;
      credit_total: string;
    }>(
      `SELECT count(p.id)::text AS posting_count,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'DEBIT')::text AS debit_total,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'CREDIT')::text AS credit_total
         FROM journals j
         JOIN postings p ON p.user_id = j.user_id AND p.journal_id = j.id
        WHERE j.user_id = $1 AND j.operation_kind = 'TRANSFER'
          AND j.transaction_id = ANY($2::uuid[])
        GROUP BY j.id
        ORDER BY j.created_at`,
      [userId, successfulTransferIds],
    );
    assert.equal(journals.rowCount, 2);
    for (const journal of journals.rows) {
      assert.equal(journal.posting_count, "2");
      assert.equal(journal.debit_total, "10000");
      assert.equal(journal.credit_total, "10000");
    }
  } finally {
    verifyClient.release();
  }
});

test("a PostgreSQL failure during the second transfer leg rolls back the whole action", async () => {
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `monikey_fail_transfer_${suffix}`;
  const triggerName = `monikey_fail_transfer_${suffix}`;
  const note = `Injected transfer rollback ${suffix}`;
  const idempotencyKey = `transfer-rollback-${suffix}`;
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;
    const source = await createFinancialAccount(
      client,
      userId,
      {
        type: "BANK",
        name: `Transfer rollback source ${suffix}`,
        openingBalanceMinor: "100000",
      },
      "2026-10-22",
    );
    const destination = await createFinancialAccount(
      client,
      userId,
      {
        type: "EWALLET",
        name: `Transfer rollback destination ${suffix}`,
        openingBalanceMinor: "75000",
      },
      "2026-10-22",
    );

    await client.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user_id = '${userId}'::uuid AND NEW.direction = 'DEBIT' THEN
          RAISE EXCEPTION 'injected transfer posting failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON postings
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);

    await client.query("SAVEPOINT transfer_attempt");
    await assert.rejects(
      runIdempotently(
        client,
        userId,
        idempotencyKey,
        {
          kind: "TRANSFER",
          fromAccountId: source.id,
          toAccountId: destination.id,
          amountMinor: "12500",
          occurredOn: "2026-10-22",
          note,
        },
        () =>
          createTransfer(
            client,
            userId,
            {
              kind: "TRANSFER",
              fromAccountId: source.id,
              toAccountId: destination.id,
              amountMinor: "12500",
              occurredOn: "2026-10-22",
              note,
            },
            "2026-10-22",
          ),
      ),
      /injected transfer posting failure/,
    );

    // The source credit was inserted before the trigger rejected the
    // destination debit. Rolling back the failed command must remove its
    // transaction, revision, journal, first posting, and audit events.
    await client.query("ROLLBACK TO SAVEPOINT transfer_attempt");

    const transferRows = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM transactions
        WHERE user_id = $1 AND note = $2`,
      [userId, note],
    );
    assert.equal(transferRows.rows[0]?.count, "0");
    const idempotencyRows = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM idempotency_keys
        WHERE user_id = $1 AND key_hash = $2`,
      [userId, createHash("sha256").update(idempotencyKey).digest("hex")],
    );
    assert.equal(idempotencyRows.rows[0]?.count, "0");
    assert.equal(
      (await readFinancialAccount(client, userId, source.id)).balanceMinor,
      "100000",
    );
    assert.equal(
      (await readFinancialAccount(client, userId, destination.id)).balanceMinor,
      "75000",
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("card purchases increase liability and payments settle it without new spending", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;
    const bank = await createFinancialAccount(
      client,
      userId,
      {
        type: "BANK",
        name: "Card funding bank",
        openingBalanceMinor: "100000",
      },
      "2026-10-22",
    );
    const card = await createFinancialAccount(
      client,
      userId,
      {
        type: "CREDIT_CARD",
        name: "Daily card",
        openingBalanceMinor: "20000",
        creditLimitMinor: "150000",
      },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food'`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);

    const purchase = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: card.id,
        categoryId: category.rows[0]!.id,
        amountMinor: "80000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(purchase.account.balanceMinor, "100000");
    assert.equal(
      (await readFinancialAccount(client, userId, bank.id)).balanceMinor,
      "100000",
    );

    const refund = await createRefund(
      client,
      userId,
      {
        kind: "REFUND",
        sourceAccountId: card.id,
        refundedTransactionId: purchase.transaction.id,
        amountMinor: "30000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(refund.account.balanceMinor, "70000");
    assert.equal(
      (await readMonthlyReport(client, userId, "2026-10")).netExpensesMinor,
      "50000",
    );
    const refundJournal = await client.query<{
      debit_account: string;
      debit_amount: string;
      credit_account: string;
      credit_amount: string;
    }>(
      `SELECT
         (SELECT la.financial_account_id::text
            FROM postings p
            JOIN ledger_accounts la ON la.user_id = p.user_id AND la.id = p.ledger_account_id
           WHERE p.user_id = j.user_id AND p.journal_id = j.id AND p.direction = 'DEBIT') AS debit_account,
         (SELECT p.amount_minor::text FROM postings p
           WHERE p.user_id = j.user_id AND p.journal_id = j.id AND p.direction = 'DEBIT') AS debit_amount,
         (SELECT la.type::text
            FROM postings p
            JOIN ledger_accounts la ON la.user_id = p.user_id AND la.id = p.ledger_account_id
           WHERE p.user_id = j.user_id AND p.journal_id = j.id AND p.direction = 'CREDIT') AS credit_account,
         (SELECT p.amount_minor::text FROM postings p
           WHERE p.user_id = j.user_id AND p.journal_id = j.id AND p.direction = 'CREDIT') AS credit_amount
       FROM journals j
       WHERE j.user_id = $1 AND j.transaction_id = $2`,
      [userId, refund.transaction.id],
    );
    assert.deepEqual(refundJournal.rows, [
      {
        debit_account: card.id,
        debit_amount: "30000",
        credit_account: "EXPENSE",
        credit_amount: "30000",
      },
    ]);

    const payment = await createCardPayment(
      client,
      userId,
      card.id,
      {
        fundingAccountId: bank.id,
        amountMinor: "30000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(payment.cardAccount.balanceMinor, "40000");
    assert.equal(payment.fundingAccount.balanceMinor, "70000");

    const journal = await client.query<{
      operation_kind: string;
      debit_total: string;
      credit_total: string;
    }>(
      `SELECT j.operation_kind,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'DEBIT')::text AS debit_total,
              sum(p.amount_minor) FILTER (WHERE p.direction = 'CREDIT')::text AS credit_total
         FROM journals j
         JOIN postings p ON p.user_id = j.user_id AND p.journal_id = j.id
        WHERE j.user_id = $1 AND j.transaction_id = $2
        GROUP BY j.id, j.operation_kind`,
      [userId, payment.transaction.id],
    );
    assert.deepEqual(journal.rows, [
      {
        operation_kind: "CARD_PAYMENT",
        debit_total: "30000",
        credit_total: "30000",
      },
    ]);

    await assert.rejects(
      createCardPayment(
        client,
        userId,
        card.id,
        {
          fundingAccountId: card.id,
          amountMinor: "1",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      TransactionConflictError,
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("edits and logical deletes reverse journals and preserve audit revisions", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;
    const account = await createFinancialAccount(
      client,
      userId,
      { type: "BANK", name: "Revision bank", openingBalanceMinor: "100000" },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food'`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);

    const original = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: account.id,
        categoryId: category.rows[0]!.id,
        amountMinor: "25000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(original.account.balanceMinor, "75000");

    const edited = await editIncomeOrExpense(
      client,
      userId,
      original.transaction.id,
      {
        kind: "EXPENSE",
        sourceAccountId: account.id,
        categoryId: category.rows[0]!.id,
        amountMinor: "20000",
        occurredOn: "2026-10-22",
        reason: "Corrected receipt total",
      },
      "2026-10-22",
    );
    assert.equal(edited.transaction.currentRevision, 2);
    assert.equal(edited.account.balanceMinor, "80000");

    const auditAfterEdit = await readTransactionAudit(
      client,
      userId,
      original.transaction.id,
    );
    assert.equal(auditAfterEdit.revisions.length, 2);
    assert.equal(auditAfterEdit.revisions[1]?.version, 2);
    assert.equal(
      auditAfterEdit.revisions[1]?.reason,
      "Corrected receipt total",
    );

    const voided = await deleteTransaction(
      client,
      userId,
      original.transaction.id,
      { reason: "Remove duplicate entry" },
      "2026-10-24",
    );
    assert.equal(voided.status, "VOID");
    assert.equal(voided.currentRevision, 3);
    const reread = await readTransactionAudit(
      client,
      userId,
      original.transaction.id,
    );
    assert.equal(reread.revisions.length, 3);
    assert.equal(reread.revisions[2]?.reason, "Remove duplicate entry");
    const balance = await readFinancialAccount(client, userId, account.id);
    assert.equal(balance.balanceMinor, "100000");

    const journals = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM journals
        WHERE user_id = $1 AND transaction_id = $2`,
      [userId, original.transaction.id],
    );
    assert.equal(journals.rows[0]?.count, "4");
    await assert.rejects(
      deleteTransaction(
        client,
        userId,
        original.transaction.id,
        {
          reason: "Try again",
        },
        "2026-10-24",
      ),
      TransactionConflictError,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
