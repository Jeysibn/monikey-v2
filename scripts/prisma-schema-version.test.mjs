import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getPrismaSchemaVersion } from "./prisma-schema-version.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "monikey-prisma-version-"));
  await writeFile(join(directory, "migration_lock.toml"), 'provider = "postgresql"\n');
  return directory;
}

test("returns the latest timestamped migration directory", async () => {
  const directory = await fixture();
  try {
    await mkdir(join(directory, "20260101000000_initial"));
    await mkdir(join(directory, "20260201000000_cards_and_bills"));
    await mkdir(join(directory, "not_a_migration"));
    assert.equal(
      await getPrismaSchemaVersion(directory),
      "20260201000000_cards_and_bills",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects missing migrations and non-PostgreSQL migration providers", async () => {
  const directory = await fixture();
  try {
    await assert.rejects(
      getPrismaSchemaVersion(directory),
      /no timestamped Prisma migrations were found/,
    );
    await mkdir(join(directory, "20260101000000_initial"));
    await writeFile(join(directory, "migration_lock.toml"), 'provider = "mysql"\n');
    await assert.rejects(
      getPrismaSchemaVersion(directory),
      /provider must be PostgreSQL/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
