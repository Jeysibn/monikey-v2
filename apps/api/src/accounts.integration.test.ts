import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createFinancialAccount, readFinancialAccount } from "./accounts.js";
import { readMonthlyReport } from "./reports.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const databaseUrl = requireDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl });

test("opening balances post against equity and read back from the ledger", async () => {
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
        name: "Opening balance bank",
        openingBalanceMinor: "1000000",
      },
      "2026-10-22",
    );
    assert.equal(bank.balanceMinor, "1000000");

    const card = await createFinancialAccount(
      client,
      userId,
      {
        type: "CREDIT_CARD",
        name: "Opening debt card",
        openingBalanceMinor: "25000",
        creditLimitMinor: "1000000",
      },
      "2026-10-22",
    );
    assert.equal(card.balanceMinor, "25000");

    const postings = await client.query<{
      account_id: string;
      ledger_type: string;
      direction: string;
      amount_minor: string;
    }>(
      `SELECT r.after_json ->> 'accountId' AS account_id,
              la.type AS ledger_type,
              p.direction,
              p.amount_minor::text AS amount_minor
         FROM transaction_revisions r
         JOIN journals j ON j.user_id = r.user_id AND j.transaction_id = r.transaction_id
         JOIN postings p ON p.user_id = j.user_id AND p.journal_id = j.id
         JOIN ledger_accounts la ON la.user_id = p.user_id AND la.id = p.ledger_account_id
        WHERE r.user_id = $1
          AND r.after_json ->> 'kind' = 'OPENING_BALANCE'
          AND r.after_json ->> 'accountId' = ANY($2::text[])
        ORDER BY account_id, ledger_type`,
      [userId, [bank.id, card.id]],
    );
    assert.equal(postings.rowCount, 4);
    const bankLegs = postings.rows
      .filter((row) => row.account_id === bank.id)
      .map((row) => [row.ledger_type, row.direction, row.amount_minor]);
    const cardLegs = postings.rows
      .filter((row) => row.account_id === card.id)
      .map((row) => [row.ledger_type, row.direction, row.amount_minor]);
    assert.deepEqual(bankLegs, [
      ["ASSET", "DEBIT", "1000000"],
      ["EQUITY", "CREDIT", "1000000"],
    ]);
    assert.deepEqual(cardLegs, [
      ["EQUITY", "DEBIT", "25000"],
      ["LIABILITY", "CREDIT", "25000"],
    ]);

    const reread = await readFinancialAccount(client, userId, bank.id);
    assert.equal(reread.balanceMinor, "1000000");
    assert.equal(
      (await readMonthlyReport(client, userId, "2026-10")).incomeMinor,
      "0",
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
