import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);
const migrationsDirectory = join(repositoryRoot, "prisma", "migrations");

export async function getPrismaSchemaVersion(directory = migrationsDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  if (migrations.length === 0) {
    throw new Error("no timestamped Prisma migrations were found");
  }

  const lock = await readFile(join(directory, "migration_lock.toml"), "utf8");
  if (!/^provider\s*=\s*"postgresql"\s*$/m.test(lock)) {
    throw new Error("Prisma migration provider must be PostgreSQL");
  }

  return migrations.at(-1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  getPrismaSchemaVersion()
    .then((version) => console.log(version))
    .catch((error) => {
      console.error(
        `Prisma schema version discovery failed: ${error instanceof Error ? error.message : "unexpected error"}`,
      );
      process.exitCode = 1;
    });
}
