import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createFinancialAccount } from "./accounts.js";
import {
  CategoryConflictError,
  CategoryNotFoundError,
  createCategory,
  listCategories,
  updateCategory,
} from "./categories.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for category tests.");
const pool = new Pool({ connectionString: databaseUrl });

test("default and custom categories remain owner-scoped and history-safe", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owners = await client.query<{
      owner: string;
      other: string;
    }>(
      `SELECT
         (SELECT id FROM users WHERE email_normalized = 'owner@example.test') AS owner,
         (SELECT id FROM users WHERE email_normalized = 'second@example.test') AS other`,
    );
    const ownerId = owners.rows[0]?.owner;
    const otherOwnerId = owners.rows[0]?.other;
    assert.ok(ownerId);
    assert.ok(otherOwnerId);

    await createFinancialAccount(
      client,
      ownerId,
      {
        type: "CASH",
        name: "Category onboarding account",
        openingBalanceMinor: "0",
      },
      "2026-10-22",
    );

    const defaults = await listCategories(client, ownerId);
    assert.equal(defaults.length, 13);
    assert.equal(
      defaults.filter((category) => category.kind === "EXPENSE").length,
      9,
    );
    assert.equal(
      defaults.filter((category) => category.kind === "INCOME").length,
      4,
    );
    const defaultMappings = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ledger_accounts
        WHERE user_id = $1 AND category_id IS NOT NULL`,
      [ownerId],
    );
    assert.equal(defaultMappings.rows[0]?.count, "13");

    const custom = await createCategory(client, ownerId, {
      kind: "EXPENSE",
      name: "Pet Care",
      sortOrder: 50,
      icon: "paw-print",
    });
    assert.equal(custom.icon, "paw-print");
    await client.query("SAVEPOINT duplicate_category");
    await assert.rejects(
      createCategory(client, ownerId, {
        kind: "EXPENSE",
        name: "Pet Care",
      }),
      CategoryConflictError,
    );
    await client.query("ROLLBACK TO SAVEPOINT duplicate_category");

    const transaction = await client.query<{ id: string }>(
      `INSERT INTO transactions (user_id, kind, occurred_on, category_id)
       VALUES ($1, 'EXPENSE', DATE '2026-10-22', $2)
       RETURNING id`,
      [ownerId, custom.id],
    );
    await client.query(
      `INSERT INTO transaction_revisions
         (user_id, transaction_id, version, before_json, after_json, actor_id)
       VALUES ($1, $2, 1, NULL, '{"kind":"EXPENSE"}'::jsonb, $1)`,
      [ownerId, transaction.rows[0]!.id],
    );

    await assert.rejects(
      updateCategory(client, otherOwnerId, custom.id, { name: "Other owner" }),
      CategoryNotFoundError,
    );
    assert.equal((await listCategories(client, otherOwnerId)).length, 0);

    const archived = await updateCategory(client, ownerId, custom.id, {
      name: "Pets",
      sortOrder: 60,
      icon: "cat",
      archived: true,
    });
    assert.ok(archived.archivedAt);
    assert.deepEqual(
      (await listCategories(client, ownerId)).some(
        (category) => category.id === custom.id,
      ),
      false,
    );
    const historicCategory = await client.query<{
      category_id: string;
      archived_at: Date | null;
    }>(
      `SELECT t.category_id, c.archived_at
         FROM transactions t
         JOIN categories c ON c.user_id = t.user_id AND c.id = t.category_id
        WHERE t.user_id = $1 AND t.id = $2`,
      [ownerId, transaction.rows[0]!.id],
    );
    assert.equal(historicCategory.rows[0]?.category_id, custom.id);
    assert.ok(historicCategory.rows[0]?.archived_at);
    assert.equal(
      (await listCategories(client, ownerId, { includeArchived: true })).length,
      14,
    );

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
