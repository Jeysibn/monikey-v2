import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount, readFinancialAccount } from "./accounts.js";
import {
  createBill,
  listBillOccurrences,
  listBills,
  payBillOccurrence,
} from "./bills.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const pool = new Pool({ connectionString: requireDatabaseUrl() });
after(async () => pool.end());

test("bills generate clamped monthly occurrences and payment posts one expense", async () => {
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
      {
        type: "BANK",
        name: "Bills funding integration",
        openingBalanceMinor: "200000",
      },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food'
        LIMIT 1`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);
    const bill = await createBill(client, userId, {
      name: "Month end food",
      categoryId: category.rows[0]!.id,
      suggestedAccountId: account.id,
      amountMode: "FIXED",
      defaultAmountMinor: "25000",
      dueDay: 31,
      startOn: "2026-01-01",
    });
    assert.ok(
      (await listBills(client, userId)).some((row) => row.id === bill.id),
    );
    const otherOwner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'owner@example.test'`,
    );
    assert.ok(otherOwner.rows[0]?.id);
    assert.deepEqual(await listBills(client, otherOwner.rows[0]!.id), []);

    const occurrences = await listBillOccurrences(
      client,
      userId,
      "2026-02-01",
      "2026-02-28",
      "2026-02-01",
    );
    const occurrence = occurrences.find((row) => row.billId === bill.id);
    assert.ok(occurrence);
    assert.equal(occurrence.dueOn, "2026-02-28");
    assert.equal(occurrence.expectedAmountMinor, "25000");
    assert.deepEqual(
      await listBillOccurrences(
        client,
        otherOwner.rows[0]!.id,
        "2026-02-01",
        "2026-02-28",
        "2026-02-01",
      ),
      [],
    );

    const paid = await payBillOccurrence(
      client,
      userId,
      occurrence.id,
      account.id,
      undefined,
      "Month end payment",
      false,
      "2026-02-28",
    );
    assert.equal(paid.occurrence.status, "PAID");
    assert.equal(paid.transaction.kind, "EXPENSE");
    assert.equal(
      (await readFinancialAccount(client, userId, account.id)).balanceMinor,
      "175000",
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
