import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount, readFinancialAccount } from "./accounts.js";
import {
  createIncomeOrExpense,
  createTransfer,
  TransactionConflictError,
  TransactionNotFoundError,
} from "./transactions.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for transaction tests.");
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
      { type: "BANK", name: "Transaction bank", openingBalanceMinor: "100000" },
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
    assert.equal(expense.account.balanceMinor, "75000");

    const income = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "INCOME",
        sourceAccountId: account.id,
        categoryId: incomeCategory.id,
        amountMinor: "40000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(income.transaction.kind, "INCOME");
    assert.equal(income.account.balanceMinor, "115000");

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
        debit_total: "40000",
        credit_total: "40000",
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
          amountMinor: "999999",
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
        amountMinor: "999999",
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
      { type: "BANK", name: "Transfer source", openingBalanceMinor: "100000" },
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

    const moved = await createTransfer(
      client,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountMinor: "20000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(moved.sourceAccount.balanceMinor, "80000");
    assert.equal(moved.destinationAccount.balanceMinor, "20000");

    const withFee = await createTransfer(
      client,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountMinor: "10000",
        feeMinor: "1500",
        feeCategoryId: feeCategory.id,
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    assert.equal(withFee.sourceAccount.balanceMinor, "68500");
    assert.equal(withFee.destinationAccount.balanceMinor, "30000");

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
        debit_total: "11500",
        credit_total: "11500",
      },
    ]);

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
