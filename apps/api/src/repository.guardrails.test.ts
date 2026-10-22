import assert from "node:assert/strict";
import test from "node:test";
import { requireDatabaseUrl } from "./test-support/database-url.js";

test("PostgreSQL-backed tests fail closed when DATABASE_URL is absent", () => {
  assert.throws(
    () => requireDatabaseUrl(""),
    /DATABASE_URL is required for PostgreSQL-backed tests/,
  );
  assert.throws(
    () => requireDatabaseUrl("   "),
    /DATABASE_URL is required for PostgreSQL-backed tests/,
  );
});

test("PostgreSQL-backed tests preserve the configured connection string", () => {
  assert.equal(
    requireDatabaseUrl("postgresql://monikey:test@localhost:5432/monikey"),
    "postgresql://monikey:test@localhost:5432/monikey",
  );
});
