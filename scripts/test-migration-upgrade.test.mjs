import assert from "node:assert/strict";
import test from "node:test";

import { validateMigrationTestAdminUrl } from "./test-migration-upgrade.mjs";

test("accepts only the dedicated loopback migration test database", () => {
  assert.equal(
    validateMigrationTestAdminUrl(
      "postgresql://monikey:test-only@localhost:15432/monikey_e2e?schema=public",
    ).hostname,
    "localhost",
  );
  assert.throws(
    () =>
      validateMigrationTestAdminUrl(
        "postgresql://monikey:test-only@db:5432/monikey_e2e",
      ),
    /loopback hosts/,
  );
  assert.throws(
    () =>
      validateMigrationTestAdminUrl(
        "postgresql://monikey:test-only@localhost:15432/monikey_v2",
      ),
    /dedicated monikey_e2e database/,
  );
  assert.throws(
    () =>
      validateMigrationTestAdminUrl(
        "postgresql://monikey:test-only@localhost:5432/monikey_e2e",
      ),
    /isolated E2E PostgreSQL port 15432/,
  );
  assert.throws(
    () =>
      validateMigrationTestAdminUrl(
        "postgresql://monikey:test-only@localhost:15432/monikey_e2e?hostaddr=192.0.2.1",
      ),
    /only schema=public/,
  );
});
