import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount } from "./accounts.js";
import {
  createCardStatement,
  listCardStatements,
  updateCardStatement,
  CardStatementConflictError,
} from "./card-statements.js";
import { createCardPayment } from "./transactions.js";
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
