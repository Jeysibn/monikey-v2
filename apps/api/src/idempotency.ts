import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export class IdempotencyConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    message = "The idempotency key was used with a different request.",
  ) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type IdempotentResult<T> = {
  value: T;
  replayed: boolean;
};

/**
 * Execute one mutation within the caller's PostgreSQL transaction.
 * The response and request fingerprint commit atomically with the mutation.
 */
export async function runIdempotently<T>(
  client: PoolClient,
  userId: string,
  key: string,
  request: unknown,
  action: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const keyHash = sha256(key);
  const requestHash = sha256(JSON.stringify(canonicalize(request)));
  let record = await client.query<{ id: string }>(
    `INSERT INTO idempotency_keys
       (user_id, key_hash, request_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')
     ON CONFLICT (user_id, key_hash) DO NOTHING
     RETURNING id`,
    [userId, keyHash, requestHash],
  );

  if (record.rowCount === 0) {
    const existing = await client.query<{
      id: string;
      request_hash: string;
      status: string;
      response_json: T | null;
      expired: boolean;
    }>(
      `SELECT id, request_hash, status, response_json, expires_at <= now() AS expired
         FROM idempotency_keys
        WHERE user_id = $1 AND key_hash = $2
        FOR UPDATE`,
      [userId, keyHash],
    );
    const prior = existing.rows[0];
    if (!prior)
      throw new IdempotencyConflictError("Idempotency state is unavailable.");

    if (prior.expired) {
      await client.query("DELETE FROM idempotency_keys WHERE id = $1", [
        prior.id,
      ]);
      record = await client.query<{ id: string }>(
        `INSERT INTO idempotency_keys
           (user_id, key_hash, request_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')
         RETURNING id`,
        [userId, keyHash, requestHash],
      );
    } else {
      if (prior.request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      if (prior.status !== "COMPLETED" || prior.response_json === null) {
        throw new IdempotencyConflictError(
          "The original request is still in progress.",
        );
      }
      return { value: prior.response_json, replayed: true };
    }
  }

  const id = record.rows[0]?.id;
  if (!id)
    throw new IdempotencyConflictError("Unable to reserve idempotency key.");

  const value = await action();
  await client.query(
    `UPDATE idempotency_keys
        SET status = 'COMPLETED', response_json = $2::jsonb
      WHERE id = $1`,
    [id, JSON.stringify(value)],
  );
  return { value, replayed: false };
}
