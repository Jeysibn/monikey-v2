import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const mode = process.argv[2];
const backupFile = process.env.BACKUP_FILE?.trim();
const restoreDatabase =
  process.env.RESTORE_DB?.trim() ?? "monikey_restore_check_local";
const backupDatabase = process.env.BACKUP_DATABASE?.trim() ?? "monikey";
const composeFiles = (
  process.env.COMPOSE_FILE ?? "compose.yaml:compose.local-test.yaml"
)
  .split(":")
  .filter(Boolean);

function usage() {
  console.error(
    "Usage: BACKUP_FILE=/protected/path.dump [BACKUP_DATABASE=monikey] npm run backup:local | npm run restore:local",
  );
  process.exitCode = 2;
}

function requireBackupFile() {
  if (!backupFile || !isAbsolute(backupFile)) {
    throw new Error(
      "BACKUP_FILE must be an absolute path outside the repository.",
    );
  }
  const relativePath = relative(repoRoot, resolve(backupFile));
  const outsideRepository =
    relativePath === ".." || relativePath.startsWith(`..${sep}`);
  if (!outsideRepository) {
    throw new Error("BACKUP_FILE must not resolve inside the repository.");
  }
  return resolve(backupFile);
}

async function safeBackupPath(file, { createDirectory = false } = {}) {
  if (createDirectory) await mkdir(dirname(file), { recursive: true });
  const repository = await realpath(repoRoot);
  const directory = await realpath(dirname(file));
  let candidate = resolve(directory, basename(file));
  if (!createDirectory) candidate = await realpath(candidate);
  const relativePath = relative(repository, candidate);
  const outsideRepository =
    relativePath === ".." || relativePath.startsWith(`..${sep}`);
  if (!outsideRepository) {
    throw new Error("BACKUP_FILE resolves inside the repository.");
  }
  return candidate;
}

function requireDatabaseName(name, variableName) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `${variableName} must be a simple PostgreSQL database name.`,
    );
  }
  return name;
}

function composeArgs(...args) {
  return [
    "compose",
    ...composeFiles.flatMap((file) => ["-f", file]),
    "exec",
    "-T",
    "db",
    ...args,
  ];
}

async function runDocker(args, { inputFile, outputFile } = {}) {
  const stdio = [
    inputFile ? "pipe" : "ignore",
    outputFile ? "pipe" : "inherit",
    "inherit",
  ];
  const child = spawn("docker", args, { stdio });
  const output = [];
  if (inputFile) createReadStream(inputFile).pipe(child.stdin);
  if (outputFile) child.stdout.on("data", (chunk) => output.push(chunk));
  const exitCode = await new Promise((resolveExit) => {
    child.once("error", (error) => {
      console.error(error.message);
      resolveExit(1);
    });
    child.once("close", resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error(`docker compose command exited with status ${exitCode}`);
  }
  return Buffer.concat(output).toString("utf8");
}

async function createBackup(file) {
  const sourceDatabase = requireDatabaseName(backupDatabase, "BACKUP_DATABASE");
  file = await safeBackupPath(file, { createDirectory: true });
  const output = createWriteStream(file, { flags: "wx", mode: 0o600 });
  const outputReady = new Promise((resolveReady, rejectReady) => {
    output.once("open", resolveReady);
    output.once("error", rejectReady);
  });
  await outputReady;
  const child = spawn(
    "docker",
    composeArgs(
      "pg_dump",
      "-U",
      "monikey",
      "-d",
      sourceDatabase,
      "--format=custom",
    ),
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  child.stdout.pipe(output);
  const exitCode = await new Promise((resolveExit) => {
    child.once("error", (error) => {
      console.error(error.message);
      resolveExit(1);
    });
    child.once("close", resolveExit);
  });
  try {
    await finished(output);
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  if (exitCode !== 0) {
    await rm(file, { force: true });
    throw new Error(`pg_dump exited with status ${exitCode}`);
  }
  const details = await stat(file);
  if (details.size === 0) throw new Error("pg_dump produced an empty archive.");
  console.log(`Backup archive created (${details.size} bytes).`);
  return file;
}

async function validateBackup(file) {
  file = await safeBackupPath(file);
  const listing = await runDocker(composeArgs("pg_restore", "--list"), {
    inputFile: file,
    outputFile: true,
  });
  if (!listing.includes("TABLE")) {
    throw new Error("pg_restore --list did not report table entries.");
  }
  console.log("Backup archive listing validated.");
  return file;
}

async function restoreBackup(file) {
  const database = requireDatabaseName(restoreDatabase, "RESTORE_DB");
  await runDocker(
    composeArgs("dropdb", "--if-exists", "-U", "monikey", database),
  );
  await runDocker(composeArgs("createdb", "-U", "monikey", database));
  try {
    await runDocker(
      composeArgs(
        "pg_restore",
        "-U",
        "monikey",
        "-d",
        database,
        "--no-owner",
        "--exit-on-error",
      ),
      { inputFile: file },
    );
    const validation = await execFileAsync("docker", [
      ...composeArgs(
        "psql",
        "-U",
        "monikey",
        "-d",
        database,
        "-Atc",
        `SELECT json_build_object(
           'users', (SELECT count(*) FROM users),
           'accounts', (SELECT count(*) FROM financial_accounts),
           'transactions', (SELECT count(*) FROM transactions),
           'journals', (SELECT count(*) FROM journals),
           'postings', (SELECT count(*) FROM postings),
           'revisions', (SELECT count(*) FROM transaction_revisions),
           'migrations', (
             SELECT count(*) FROM "_prisma_migrations"
              WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
           ),
           'journalsBalanced', NOT EXISTS (
             SELECT 1
               FROM journals j
               LEFT JOIN postings p ON p.user_id = j.user_id AND p.journal_id = j.id
              GROUP BY j.user_id, j.id
             HAVING count(p.id) < 2
                 OR COALESCE(sum(p.amount_minor) FILTER (WHERE p.direction = 'DEBIT'), 0)
                    <> COALESCE(sum(p.amount_minor) FILTER (WHERE p.direction = 'CREDIT'), 0)
           ),
           'currentRevisionsPresent', NOT EXISTS (
             SELECT 1
               FROM transactions t
               LEFT JOIN transaction_revisions r
                 ON r.user_id = t.user_id
                AND r.transaction_id = t.id
                AND r.version = t.current_revision
              WHERE r.id IS NULL
           ),
           'postedTransactionsJournaled', NOT EXISTS (
             SELECT 1
               FROM transactions t
              WHERE t.status = 'POSTED'
                AND NOT EXISTS (
                  SELECT 1 FROM journals j
                   WHERE j.user_id = t.user_id AND j.transaction_id = t.id
                )
           )
         )::text;`,
      ),
    ]);
    const restored = JSON.parse(validation.stdout.trim());
    if (
      restored.users < 1 ||
      restored.migrations < 1 ||
      !restored.journalsBalanced ||
      !restored.currentRevisionsPresent ||
      !restored.postedTransactionsJournaled
    ) {
      throw new Error("Isolated restore validation did not pass.");
    }
    console.log(
      `Isolated restore verified (${restored.users} users, ${restored.accounts} accounts, ${restored.transactions} transactions, ${restored.journals} journals, ${restored.postings} postings, ${restored.revisions} revisions); ledger and revision invariants passed.`,
    );
  } finally {
    await runDocker(composeArgs("dropdb", "-U", "monikey", database));
    console.log("Isolated restore database removed.");
  }
}

if (!mode || !["backup", "restore"].includes(mode)) {
  usage();
} else {
  try {
    const file = requireBackupFile();
    if (mode === "backup") {
      const createdFile = await createBackup(file);
      await validateBackup(createdFile);
    } else {
      const validatedFile = await validateBackup(file);
      await restoreBackup(validatedFile);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Backup command failed.",
    );
    process.exitCode = 1;
  }
}
