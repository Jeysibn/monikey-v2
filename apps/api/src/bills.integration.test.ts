import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount, readFinancialAccount } from "./accounts.js";
import {
  createBill,
  listBillOccurrences,
  listBills,
  payBillOccurrence,
  updateBill,
} from "./bills.js";
import { deleteTransaction, editIncomeOrExpense } from "./transactions.js";
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

test("bill payment edits and voids reconcile the occurrence and retain history", async () => {
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
        name: "Bill correction bank",
        openingBalanceMinor: "200000",
      },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Utilities' LIMIT 1`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);
    const bill = await createBill(client, userId, {
      name: "Correction utility",
      categoryId: category.rows[0]!.id,
      suggestedAccountId: bank.id,
      amountMode: "FIXED",
      defaultAmountMinor: "25000",
      dueDay: 25,
      startOn: "2026-01-01",
    });
    const occurrence = (
      await listBillOccurrences(
        client,
        userId,
        "2026-10-01",
        "2026-10-31",
        "2026-10-24",
      )
    ).find((item) => item.billId === bill.id);
    assert.ok(occurrence);
    const paid = await payBillOccurrence(
      client,
      userId,
      occurrence.id,
      bank.id,
      undefined,
      "Bill payment",
      false,
      "2026-10-24",
    );
    assert.equal(paid.occurrence.status, "PAID");
    const revised = await editIncomeOrExpense(
      client,
      userId,
      paid.transaction.id,
      {
        kind: "EXPENSE",
        sourceAccountId: bank.id,
        categoryId: category.rows[0]!.id,
        amountMinor: "20000",
        occurredOn: "2026-10-23",
        reason: "Corrected bill receipt",
      },
      "2026-10-24",
    );
    assert.equal(revised.transaction.currentRevision, 2);
    const afterEdit = (
      await listBillOccurrences(
        client,
        userId,
        "2026-10-01",
        "2026-10-31",
        "2026-10-24",
      )
    ).find((item) => item.id === occurrence.id);
    assert.equal(afterEdit?.status, "PAID");
    assert.equal(afterEdit?.actualAmountMinor, "20000");

    await deleteTransaction(
      client,
      userId,
      paid.transaction.id,
      { reason: "Void incorrect bill payment" },
      "2026-10-24",
    );
    const reopened = (
      await listBillOccurrences(
        client,
        userId,
        "2026-10-01",
        "2026-10-31",
        "2026-10-24",
      )
    ).find((item) => item.id === occurrence.id);
    assert.equal(reopened?.status, "UPCOMING");
    assert.equal(reopened?.paidTransactionId, null);
    assert.equal(reopened?.actualAmountMinor, null);

    const history = await client.query<{ actions: string }>(
      `SELECT string_agg(action, ',' ORDER BY sequence_number) AS actions
         FROM bill_occurrence_payment_history
        WHERE user_id = $1 AND occurrence_id = $2`,
      [userId, occurrence.id],
    );
    assert.equal(history.rows[0]?.actions, "POSTED,EDITED,VOIDED");
    const replacement = await payBillOccurrence(
      client,
      userId,
      occurrence.id,
      bank.id,
      undefined,
      "Replacement payment",
      false,
      "2026-10-24",
    );
    assert.equal(replacement.occurrence.status, "PAID");
    assert.notEqual(replacement.transaction.id, paid.transaction.id);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("bill edits reconcile unpaid future dates and preserve paid monthly history", async () => {
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
        name: "Bill schedule bank",
        openingBalanceMinor: "300000",
      },
      "2026-10-22",
    );
    const category = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Utilities' LIMIT 1`,
      [userId],
    );
    assert.ok(category.rows[0]?.id);
    const bill = await createBill(client, userId, {
      name: "Schedule changing bill",
      categoryId: category.rows[0]!.id,
      suggestedAccountId: bank.id,
      amountMode: "FIXED",
      defaultAmountMinor: "10000",
      dueDay: 25,
      startOn: "2026-01-01",
    });
    const october = (
      await listBillOccurrences(
        client,
        userId,
        "2026-10-01",
        "2026-10-31",
        "2026-10-24",
      )
    ).find((item) => item.billId === bill.id);
    assert.ok(october);
    await payBillOccurrence(
      client,
      userId,
      october.id,
      bank.id,
      undefined,
      undefined,
      false,
      "2026-10-24",
    );
    await listBillOccurrences(
      client,
      userId,
      "2026-11-01",
      "2026-11-30",
      "2026-10-24",
    );
    await updateBill(
      client,
      userId,
      bill.id,
      { dueDay: 27, defaultAmountMinor: "20000" },
      "2026-10-24",
    );
    const currentAndFuture = await listBillOccurrences(
      client,
      userId,
      "2026-10-01",
      "2026-12-31",
      "2026-10-24",
    );
    const billOccurrences = currentAndFuture.filter(
      (item) => item.billId === bill.id,
    );
    assert.deepEqual(
      billOccurrences.map((item) => [
        item.dueOn,
        item.expectedAmountMinor,
        item.status,
      ]),
      [
        ["2026-10-25", "10000", "PAID"],
        ["2026-11-27", "20000", "UPCOMING"],
        ["2026-12-27", "20000", "UPCOMING"],
      ],
    );
    await updateBill(
      client,
      userId,
      bill.id,
      { startOn: "2026-11-01", endOn: "2026-12-31" },
      "2026-10-24",
    );
    const dateChanged = await listBillOccurrences(
      client,
      userId,
      "2026-10-01",
      "2026-12-31",
      "2026-10-24",
    );
    assert.deepEqual(
      dateChanged
        .filter((item) => item.billId === bill.id)
        .map((item) => item.dueOn),
      ["2026-10-25", "2026-11-27", "2026-12-27"],
    );
    await updateBill(
      client,
      userId,
      bill.id,
      { status: "PAUSED" },
      "2026-10-24",
    );
    const pausedUpcoming = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bill_occurrences
        WHERE user_id = $1 AND bill_id = $2 AND status IN ('UPCOMING', 'OVERDUE')`,
      [userId, bill.id],
    );
    assert.equal(pausedUpcoming.rows[0]?.count, "0");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
