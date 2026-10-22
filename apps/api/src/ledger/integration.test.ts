import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { moneyMinor } from "@monikey/money";
import { LedgerNotFoundError, postBalancedJournal } from "./service.js";
import { LedgerValidationError } from "./domain.js";
import { requireDatabaseUrl } from "../test-support/database-url.js";

const databaseUrl = requireDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl });

test("posts one audited balanced journal within its caller transaction", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owners = await client.query<{ owner_one: string; owner_two: string }>(
      `SELECT
         (SELECT id FROM users WHERE email_normalized = 'owner@example.test') AS owner_one,
         (SELECT id FROM users WHERE email_normalized = 'second@example.test') AS owner_two`,
    );
    const { owner_one: ownerId, owner_two: secondOwnerId } = owners.rows[0]!;
    assert.ok(ownerId);
    assert.ok(secondOwnerId);

    const account = await client.query<{ id: string }>(
      `INSERT INTO financial_accounts (user_id, type, name)
       VALUES ($1, 'BANK', 'Ledger integration bank')
       RETURNING id`,
      [ownerId],
    );
    const category = await client.query<{ id: string }>(
      `INSERT INTO categories (user_id, kind, name)
       VALUES ($1, 'EXPENSE', 'Ledger integration expense')
       RETURNING id`,
      [ownerId],
    );
    const bankLedger = await client.query<{ id: string }>(
      `INSERT INTO ledger_accounts (user_id, type, financial_account_id)
       VALUES ($1, 'ASSET', $2)
       RETURNING id`,
      [ownerId, account.rows[0]!.id],
    );
    const expenseLedger = await client.query<{ id: string }>(
      `INSERT INTO ledger_accounts (user_id, type, category_id)
       VALUES ($1, 'EXPENSE', $2)
       RETURNING id`,
      [ownerId, category.rows[0]!.id],
    );
    const otherAccount = await client.query<{ id: string }>(
      `INSERT INTO financial_accounts (user_id, type, name)
       VALUES ($1, 'BANK', 'Other owner integration bank')
       RETURNING id`,
      [secondOwnerId],
    );
    const otherLedger = await client.query<{ id: string }>(
      `INSERT INTO ledger_accounts (user_id, type, financial_account_id)
       VALUES ($1, 'ASSET', $2)
       RETURNING id`,
      [secondOwnerId, otherAccount.rows[0]!.id],
    );

    const transaction = await client.query<{ id: string }>(
      `INSERT INTO transactions (user_id, kind, occurred_on, category_id)
       VALUES ($1, 'EXPENSE', DATE '2026-10-22', $2)
       RETURNING id`,
      [ownerId, category.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO transaction_revisions
         (user_id, transaction_id, version, before_json, after_json, actor_id)
       VALUES ($1, $2, 1, NULL, '{"kind":"EXPENSE"}'::jsonb, $1)`,
      [ownerId, transaction.rows[0]!.id],
    );

    const journalId = await postBalancedJournal(client, {
      userId: ownerId,
      transactionId: transaction.rows[0]!.id,
      operationKind: "EXPENSE",
      postings: [
        {
          ledgerAccountId: expenseLedger.rows[0]!.id,
          direction: "DEBIT",
          amountMinor: moneyMinor("25000"),
        },
        {
          ledgerAccountId: bankLedger.rows[0]!.id,
          direction: "CREDIT",
          amountMinor: moneyMinor("25000"),
        },
      ],
    });

    const rows = await client.query<{
      posting_count: string;
      debit_total: string;
      credit_total: string;
    }>(
      `SELECT count(*)::text AS posting_count,
              sum(amount_minor) FILTER (WHERE direction = 'DEBIT')::text AS debit_total,
              sum(amount_minor) FILTER (WHERE direction = 'CREDIT')::text AS credit_total
         FROM postings
        WHERE user_id = $1 AND journal_id = $2`,
      [ownerId, journalId],
    );
    assert.equal(rows.rows[0]!.posting_count, "2");
    assert.equal(rows.rows[0]!.debit_total, "25000");
    assert.equal(rows.rows[0]!.credit_total, "25000");

    const audit = await client.query(
      `SELECT id FROM audit_events
        WHERE user_id = $1 AND entity_type = 'JOURNAL' AND entity_id = $2 AND action = 'POSTED'`,
      [ownerId, journalId],
    );
    assert.equal(audit.rowCount, 1);

    await assert.rejects(
      postBalancedJournal(client, {
        userId: ownerId,
        transactionId: transaction.rows[0]!.id,
        operationKind: "EXPENSE",
        postings: [
          {
            ledgerAccountId: expenseLedger.rows[0]!.id,
            direction: "DEBIT",
            amountMinor: moneyMinor("25000"),
          },
          {
            ledgerAccountId: bankLedger.rows[0]!.id,
            direction: "CREDIT",
            amountMinor: moneyMinor("24999"),
          },
        ],
      }),
      LedgerValidationError,
    );

    await assert.rejects(
      postBalancedJournal(client, {
        userId: ownerId,
        transactionId: transaction.rows[0]!.id,
        operationKind: "EXPENSE",
        postings: [
          {
            ledgerAccountId: expenseLedger.rows[0]!.id,
            direction: "DEBIT",
            amountMinor: moneyMinor("25000"),
          },
          {
            ledgerAccountId: otherLedger.rows[0]!.id,
            direction: "CREDIT",
            amountMinor: moneyMinor("25000"),
          },
        ],
      }),
      LedgerNotFoundError,
    );

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
