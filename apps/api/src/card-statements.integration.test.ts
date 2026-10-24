import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount, readFinancialAccount } from "./accounts.js";
import {
  createCardStatement,
  listCardStatements,
  updateCardStatement,
  CardStatementConflictError,
} from "./card-statements.js";
import {
  createAdjustment,
  createCardPayment,
  createIncomeOrExpense,
  createRefund,
  deleteTransaction,
  TransactionConflictError,
} from "./transactions.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const pool = new Pool({ connectionString: requireDatabaseUrl() });
after(async () => pool.end());

test("card statements retain manual amounts and allocation history", async () => {
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
        name: "Statement funding",
        openingBalanceMinor: "200000",
      },
      "2026-10-22",
    );
    const card = await createFinancialAccount(
      client,
      userId,
      {
        type: "CREDIT_CARD",
        name: "Statement card",
        openingBalanceMinor: "0",
        creditLimitMinor: "500000",
      },
      "2026-10-22",
    );
    const created = await createCardStatement(client, userId, card.id, {
      statementDate: "2026-10-20",
      periodStart: "2026-09-20",
      periodEnd: "2026-10-19",
      amountDueMinor: "100000",
      paymentDueDate: "2026-11-02",
      note: "October statement",
    });
    assert.equal(created.remainingDueMinor, "100000");

    const payment = await createCardPayment(
      client,
      userId,
      card.id,
      {
        fundingAccountId: bank.id,
        statementId: created.id,
        amountMinor: "40000",
        occurredOn: "2026-10-22",
        acknowledgeCardCreditBalance: true,
      },
      "2026-10-22",
    );
    assert.equal(payment.transaction.kind, "CARD_PAYMENT");
    const afterPayment = (
      await listCardStatements(client, userId, card.id)
    ).find((statement) => statement.id === created.id);
    assert.ok(afterPayment);
    assert.equal(afterPayment.allocatedMinor, "40000");
    assert.equal(afterPayment.remainingDueMinor, "60000");

    const foodCategory = await client.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food'`,
      [userId],
    );
    assert.ok(foodCategory.rows[0]?.id);
    await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: card.id,
        categoryId: foodCategory.rows[0]!.id,
        amountMinor: "25000",
        occurredOn: "2026-10-22",
        note: "Purchase after statement",
      },
      "2026-10-22",
    );
    const afterNewPurchase = (
      await listCardStatements(client, userId, card.id)
    ).find((statement) => statement.id === created.id);
    assert.ok(afterNewPurchase);
    assert.equal(afterNewPurchase.amountDueMinor, "100000");
    assert.equal(afterNewPurchase.allocatedMinor, "40000");
    assert.equal(afterNewPurchase.remainingDueMinor, "60000");

    await assert.rejects(
      updateCardStatement(client, userId, card.id, created.id, {
        amountDueMinor: "30000",
      }),
      CardStatementConflictError,
    );
    const corrected = await updateCardStatement(
      client,
      userId,
      card.id,
      created.id,
      { amountDueMinor: "120000" },
    );
    assert.equal(corrected.amountDueMinor, "120000");
    assert.equal(corrected.remainingDueMinor, "80000");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("voiding a card payment reverses its active statement allocation atomically", async () => {
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
        name: "Allocation reversal bank",
        openingBalanceMinor: "200000",
      },
      "2026-10-22",
    );
    const card = await createFinancialAccount(
      client,
      userId,
      {
        type: "CREDIT_CARD",
        name: "Allocation reversal card",
        openingBalanceMinor: "100000",
        creditLimitMinor: "300000",
      },
      "2026-10-22",
    );
    const statement = await createCardStatement(client, userId, card.id, {
      statementDate: "2026-10-20",
      amountDueMinor: "100000",
      paymentDueDate: "2026-11-02",
    });
    const first = await createCardPayment(
      client,
      userId,
      card.id,
      {
        fundingAccountId: bank.id,
        statementId: statement.id,
        amountMinor: "40000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    await deleteTransaction(
      client,
      userId,
      first.transaction.id,
      { reason: "Correct the payment allocation" },
      "2026-10-24",
    );
    const reopened = (await listCardStatements(client, userId, card.id)).find(
      (item) => item.id === statement.id,
    );
    assert.equal(reopened?.allocatedMinor, "0");
    assert.equal(reopened?.remainingDueMinor, "100000");

    await createCardPayment(
      client,
      userId,
      card.id,
      {
        fundingAccountId: bank.id,
        statementId: statement.id,
        amountMinor: "100000",
        occurredOn: "2026-10-24",
      },
      "2026-10-24",
    );
    const paid = (await listCardStatements(client, userId, card.id)).find(
      (item) => item.id === statement.id,
    );
    assert.equal(paid?.allocatedMinor, "100000");
    assert.equal(paid?.remainingDueMinor, "0");
    const allocationHistory = await client.query<{
      allocations: string;
      reversed: string;
      reversalAudits: string;
    }>(
      `SELECT count(*)::text AS allocations,
              count(*) FILTER (WHERE reversed_at IS NOT NULL)::text AS reversed,
              (SELECT count(*)::text FROM audit_events
                WHERE user_id = $1 AND entity_type = 'CARD_STATEMENT_ALLOCATION'
                  AND action = 'REVERSED') AS "reversalAudits"
         FROM card_statement_allocations WHERE user_id = $1 AND statement_id = $2`,
      [userId, statement.id],
    );
    assert.deepEqual(allocationHistory.rows[0], {
      allocations: "2",
      reversed: "1",
      reversalAudits: "1",
    });
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("credit-producing card commands require separate card-credit acknowledgement", async () => {
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
        name: "Credit confirmation bank",
        openingBalanceMinor: "100000",
      },
      "2026-10-22",
    );
    const card = await createFinancialAccount(
      client,
      userId,
      {
        type: "CREDIT_CARD",
        name: "Credit confirmation card",
        openingBalanceMinor: "0",
        creditLimitMinor: "200000",
      },
      "2026-10-22",
    );
    const payment = {
      fundingAccountId: bank.id,
      amountMinor: "5000",
      occurredOn: "2026-10-22",
    };
    const cardCreditError = (error: unknown) =>
      error instanceof TransactionConflictError &&
      error.message.includes("card credit balance");
    await assert.rejects(
      createCardPayment(client, userId, card.id, payment, "2026-10-22"),
      cardCreditError,
    );
    await assert.rejects(
      createCardPayment(
        client,
        userId,
        card.id,
        { ...payment, acknowledgeNegativeBalance: true },
        "2026-10-22",
      ),
      cardCreditError,
    );
    await createCardPayment(
      client,
      userId,
      card.id,
      { ...payment, acknowledgeCardCreditBalance: true },
      "2026-10-22",
    );
    assert.equal(
      (await readFinancialAccount(client, userId, card.id)).balanceMinor,
      "-5000",
    );

    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food' LIMIT 1`,
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
        amountMinor: "10000",
        occurredOn: "2026-10-22",
      },
      "2026-10-22",
    );
    const refund = {
      kind: "REFUND" as const,
      sourceAccountId: card.id,
      refundedTransactionId: purchase.transaction.id,
      amountMinor: "10000",
      occurredOn: "2026-10-22",
    };
    await assert.rejects(
      createRefund(client, userId, refund, "2026-10-22"),
      cardCreditError,
    );
    await createRefund(
      client,
      userId,
      { ...refund, acknowledgeCardCreditBalance: true },
      "2026-10-22",
    );
    await assert.rejects(
      createAdjustment(
        client,
        userId,
        {
          kind: "ADJUSTMENT",
          accountId: card.id,
          direction: "DECREASE",
          amountMinor: "1000",
          occurredOn: "2026-10-22",
        },
        "2026-10-22",
      ),
      cardCreditError,
    );
    await createAdjustment(
      client,
      userId,
      {
        kind: "ADJUSTMENT",
        accountId: card.id,
        direction: "DECREASE",
        amountMinor: "1000",
        occurredOn: "2026-10-22",
        acknowledgeCardCreditBalance: true,
      },
      "2026-10-22",
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
