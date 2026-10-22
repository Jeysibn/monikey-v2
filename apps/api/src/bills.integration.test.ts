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
import { runIdempotently } from "./idempotency.js";
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

test("variable bill payment requires an amount and retries idempotently", async () => {
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
        name: "Variable bill funding",
        openingBalanceMinor: "200000",
      },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Utilities'
        LIMIT 1`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);
    const bill = await createBill(client, userId, {
      name: "Variable utility bill",
      categoryId: category.rows[0]!.id,
      suggestedAccountId: account.id,
      amountMode: "VARIABLE",
      dueDay: 15,
      startOn: "2026-01-01",
    });
    const occurrence = (
      await listBillOccurrences(
        client,
        userId,
        "2026-10-01",
        "2026-10-31",
        "2026-10-22",
      )
    ).find((item) => item.billId === bill.id);
    assert.ok(occurrence);
    assert.equal(occurrence.expectedAmountMinor, null);
    await assert.rejects(
      payBillOccurrence(
        client,
        userId,
        occurrence.id,
        account.id,
        undefined,
        undefined,
        false,
        "2026-10-22",
      ),
      /Variable bills require an actual amount/,
    );

    const request = {
      occurrenceId: occurrence.id,
      fundingAccountId: account.id,
      amountMinor: "33000",
      note: "Actual utility amount",
    };
    const first = await runIdempotently(
      client,
      userId,
      "variable-bill-payment-retry-0001",
      request,
      () =>
        payBillOccurrence(
          client,
          userId,
          occurrence.id,
          account.id,
          request.amountMinor,
          request.note,
          false,
          "2026-10-22",
        ),
    );
    const replay = await runIdempotently(
      client,
      userId,
      "variable-bill-payment-retry-0001",
      request,
      async () => {
        throw new Error("The idempotent retry must not post again.");
      },
    );
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.value, first.value);
    assert.equal(first.value.occurrence.actualAmountMinor, "33000");
    assert.equal(
      (await readFinancialAccount(client, userId, account.id)).balanceMinor,
      "167000",
    );
    const posted = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM transactions
        WHERE user_id = $1 AND kind = 'EXPENSE' AND note = 'Actual utility amount'`,
      [userId],
    );
    assert.equal(posted.rows[0]?.count, "1");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
