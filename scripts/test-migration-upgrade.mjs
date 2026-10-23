import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const apiRequire = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { Client } = apiRequire("pg");
const prismaCli = join(repositoryRoot, "node_modules/prisma/build/index.js");
const migrationsRoot = join(repositoryRoot, "prisma/migrations");

export function validateMigrationTestAdminUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "MIGRATION_TEST_DATABASE_URL must be a valid PostgreSQL URL",
    );
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^(postgres|postgresql):$/.test(url.protocol)) {
    throw new Error("migration upgrade tests require PostgreSQL");
  }
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error("migration upgrade tests are restricted to loopback hosts");
  }
  if (url.port !== "15432") {
    throw new Error(
      "migration upgrade tests require the isolated E2E PostgreSQL port 15432",
    );
  }
  if (database !== "monikey_e2e") {
    throw new Error(
      "migration upgrade tests require the dedicated monikey_e2e database connection",
    );
  }
  if (
    [...url.searchParams.entries()].some(
      ([key, value]) => key !== "schema" || value !== "public",
    )
  ) {
    throw new Error("only schema=public is allowed in the migration test URL");
  }
  return url;
}

function runPrisma(cwd, configPath, databaseUrl, args) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, ...args, "--config", configPath],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Prisma ${args.join(" ")} exited with status ${result.status}`,
    );
  }
}

async function migrationDirectories() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter(
      (entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (migrations.length < 2) {
    throw new Error(
      "migration upgrade verification requires at least two migrations",
    );
  }
  return migrations;
}

export async function runMigrationUpgradeTest({
  databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL,
} = {}) {
  if (process.env.MIGRATION_TEST_ALLOW_CREATE_DB !== "1") {
    throw new Error(
      "set MIGRATION_TEST_ALLOW_CREATE_DB=1 to enable disposable database creation",
    );
  }
  const adminUrl = validateMigrationTestAdminUrl(databaseUrl);
  const migrations = await migrationDirectories();
  const latest = migrations.at(-1);
  const scratchDatabase = `monikey_migration_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const scratchUrl = new URL(adminUrl);
  scratchUrl.pathname = `/${scratchDatabase}`;
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "monikey-migration-upgrade-"),
  );
  const configPath = join(temporaryRoot, "prisma.config.mjs");
  const priorMigrationsRoot = join(temporaryRoot, "prisma", "migrations");
  const admin = new Client({ connectionString: adminUrl.href });
  let databaseCreated = false;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratchDatabase}"`);
    databaseCreated = true;

    await cp(
      join(repositoryRoot, "prisma/schema.prisma"),
      join(temporaryRoot, "schema.prisma"),
    );
    await cp(migrationsRoot, priorMigrationsRoot, {
      recursive: true,
      filter: (source) => !source.endsWith(latest),
    });
    await writeFile(
      configPath,
      [
        'import process from "node:process";',
        "export default {",
        '  schema: "schema.prisma",',
        '  migrations: { path: "prisma/migrations" },',
        "  datasource: { url: process.env.DATABASE_URL },",
        "};",
        "",
      ].join("\n"),
    );

    console.log(
      `Applying previous V2 schema (${migrations.length - 1} migrations) to ${scratchDatabase}.`,
    );
    runPrisma(temporaryRoot, configPath, scratchUrl.href, [
      "migrate",
      "deploy",
    ]);

    console.log(`Applying current migration ${latest} to the previous schema.`);
    runPrisma(
      repositoryRoot,
      join(repositoryRoot, "prisma.config.js"),
      scratchUrl.href,
      ["migrate", "deploy"],
    );
    runPrisma(
      repositoryRoot,
      join(repositoryRoot, "prisma.config.js"),
      scratchUrl.href,
      ["migrate", "status"],
    );

    const verification = new Client({ connectionString: scratchUrl.href });
    try {
      await verification.connect();
      const applied = await verification.query(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name",
      );
      const tables = await verification.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [["card_statements", "bills", "bill_occurrences"]],
      );
      if (applied.rows.length !== migrations.length) {
        throw new Error(
          `expected ${migrations.length} successful migrations; found ${applied.rows.length}`,
        );
      }
      if (applied.rows.at(-1)?.migration_name !== latest) {
        throw new Error(
          "latest Prisma migration is not recorded as successfully applied",
        );
      }
      const expectedTables = ["bill_occurrences", "bills", "card_statements"];
      if (
        tables.rows.map((row) => row.table_name).join(",") !==
        expectedTables.join(",")
      ) {
        throw new Error(
          "the latest card and bill tables are missing after migration upgrade",
        );
      }
      console.log(
        `Verified ${applied.rows.length} migrations and ${expectedTables.join(", ")}.`,
      );
    } finally {
      await verification.end();
    }
  } finally {
    if (databaseCreated) {
      await admin.query(`DROP DATABASE "${scratchDatabase}" WITH (FORCE)`);
      console.log(`Dropped disposable migration database ${scratchDatabase}.`);
    }
    await admin.end();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runMigrationUpgradeTest().catch((error) => {
    console.error(
      `Migration upgrade verification failed: ${error instanceof Error ? error.message : "unexpected error"}`,
    );
    process.exitCode = 1;
  });
}
