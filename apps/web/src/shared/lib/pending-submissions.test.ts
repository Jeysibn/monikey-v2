import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPendingSubmission,
  clearPendingSubmission,
  listPendingSubmissions,
  pendingSubmissionMatchesPayload,
  pendingSubmissionKey,
} from "./pending-submissions";

test("explicit retries reuse one identity while identical new actions stay distinct", async () => {
  const userId = crypto.randomUUID();
  const operation = "test:identical-actions";
  const purchase = {
    kind: "EXPENSE",
    amountMinor: "10000",
    occurredOn: "2026-10-24",
    note: "coffee",
  };

  const first = await beginPendingSubmission(
    userId,
    operation,
    "purchase-a",
    purchase,
  );
  const replay = await beginPendingSubmission(
    userId,
    operation,
    "purchase-a",
    purchase,
  );
  const second = await beginPendingSubmission(
    userId,
    operation,
    "purchase-b",
    purchase,
  );

  assert.equal(replay.key, first.key);
  assert.notEqual(second.key, first.key);
  assert.equal(listPendingSubmissions(userId, operation).length, 2);
  assert.equal(
    await pendingSubmissionMatchesPayload(
      userId,
      operation,
      first.id,
      purchase,
    ),
    true,
  );

  clearPendingSubmission(userId, operation, first.key);
  assert.deepEqual(
    listPendingSubmissions(userId, operation).map(({ id, key }) => ({
      id,
      key,
    })),
    [second],
  );
});

test("an edited saved retry is rejected and cannot reuse its idempotency key", async () => {
  const userId = crypto.randomUUID();
  const operation = "test:edited-retry";
  const original = await beginPendingSubmission(
    userId,
    operation,
    "operation-a",
    { amountMinor: "10000" },
  );

  await assert.rejects(
    beginPendingSubmission(
      userId,
      operation,
      original.id,
      { amountMinor: "20000" },
      true,
    ),
    /do not match the saved attempt/,
  );
  assert.deepEqual(
    listPendingSubmissions(userId, operation).map(({ id, key }) => ({
      id,
      key,
    })),
    [original],
  );
});

test("payload-based correction retries reuse only matching owner and operation keys", async () => {
  const user = crypto.randomUUID();
  const operation = "bill:create";
  const payload = { amountMinor: "10000", name: "Rent" };
  const key = await pendingSubmissionKey(user, operation, payload);
  assert.equal(await pendingSubmissionKey(user, operation, payload), key);
  assert.notEqual(
    await pendingSubmissionKey(user, operation, {
      ...payload,
      amountMinor: "20000",
    }),
    key,
  );
  assert.notEqual(
    await pendingSubmissionKey(crypto.randomUUID(), operation, payload),
    key,
  );
  assert.notEqual(
    await pendingSubmissionKey(user, "statement:create", payload),
    key,
  );
  clearPendingSubmission(user, operation, key);
  assert.notEqual(await pendingSubmissionKey(user, operation, payload), key);
});
