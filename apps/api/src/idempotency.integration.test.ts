import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Pool } from "pg";
import { IdempotencyConflictError, runIdempotently } from "./idempotency.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const pool = new Pool({ connectionString: requireDatabaseUrl() });
after(async () => pool.end());

test("concurrent identical requests execute once and replay from PostgreSQL", async () => {
  const user = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
  );
  assert.ok(user.rows[0]?.id);
  const userId = user.rows[0].id;
  const request = { operation: "fixture", amountMinor: "25000" };
  const key = `concurrent-idempotency-${randomUUID()}`;
  let actionCalls = 0;

  async function submit() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await runIdempotently(
        client,
        userId,
        key,
        request,
        async () => {
          actionCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 40));
          return {
            operationId: randomUUID(),
            amountMinor: request.amountMinor,
          };
        },
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  try {
    const [first, second] = await Promise.all([submit(), submit()]);
    assert.equal(actionCalls, 1);
    assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
    assert.deepEqual(first.value, second.value);

    const restartClient = await pool.connect();
    try {
      await restartClient.query("BEGIN");
      const replay = await runIdempotently(
        restartClient,
        userId,
        key,
        request,
        async () => {
          throw new Error("A committed retry must not execute its command.");
        },
      );
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.value, first.value);

      await assert.rejects(
        runIdempotently(
          restartClient,
          userId,
          key,
          { ...request, amountMinor: "26000" },
          async () => {
            throw new Error(
              "A conflicting retry must not execute its command.",
            );
          },
        ),
        IdempotencyConflictError,
      );
      await restartClient.query("COMMIT");
    } catch (error) {
      await restartClient.query("ROLLBACK");
      throw error;
    } finally {
      restartClient.release();
    }
  } finally {
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query(
        `DELETE FROM idempotency_keys WHERE user_id = $1 AND key_hash = $2`,
        [userId, createHash("sha256").update(key).digest("hex")],
      );
    } finally {
      cleanupClient.release();
    }
  }
});
