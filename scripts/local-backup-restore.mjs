import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const mode = process.argv[2];
const backupFile = process.env.BACKUP_FILE?.trim();
const restoreDatabase =
  process.env.RESTORE_DB?.trim() ?? "monikey_restore_check_local";
const composeFiles = (
  process.env.COMPOSE_FILE ?? "compose.yaml:compose.local-test.yaml"
)
  .split(":")
  .filter(Boolean);

function usage() {
  console.error(
    "Usage: BACKUP_FILE=/protected/path.dump npm run backup:local | npm run restore:local",
  );
  process.exitCode = 2;
}

function requireBackupFile() {
  if (!backupFile || !isAbsolute(backupFile)) {
    throw new Error(
      "BACKUP_FILE must be an absolute path outside the repository.",
    );
  }
  if (!relative(repoRoot, backupFile).startsWith("..")) {
    throw new Error("BACKUP_FILE must not be inside the repository.");
  }
  return backupFile;
}

function requireDatabaseName() {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(restoreDatabase)) {
    throw new Error("RESTORE_DB must be a simple PostgreSQL database name.");
  }
  return restoreDatabase;
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
  await mkdir(dirname(file), { recursive: true });
  const output = createWriteStream(file, { flags: "wx", mode: 0o600 });
  const outputReady = new Promise((resolveReady, rejectReady) => {
    output.once("open", resolveReady);
    output.once("error", rejectReady);
  });
  await outputReady;
  const child = spawn(
    "docker",
    composeArgs("pg_dump", "-U", "monikey", "-d", "monikey", "--format=custom"),
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
}

async function validateBackup(file) {
  const listing = await runDocker(composeArgs("pg_restore", "--list"), {
    inputFile: file,
    outputFile: true,
  });
  if (!listing.includes("TABLE")) {
    throw new Error("pg_restore --list did not report table entries.");
  }
  console.log("Backup archive listing validated.");
}

async function restoreBackup(file) {
  const database = requireDatabaseName();
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
        "SELECT (SELECT count(*) FROM users) > 0 AND (SELECT count(*) FROM journals) >= 0 AND (SELECT count(*) FROM transaction_revisions) >= 0;",
      ),
    ]);
    if (validation.stdout.trim() !== "t") {
      throw new Error("Isolated restore validation did not pass.");
    }
    console.log("Isolated restore and schema/data presence validation passed.");
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
      await createBackup(file);
      await validateBackup(file);
    } else {
      await validateBackup(file);
      await restoreBackup(file);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Backup command failed.",
    );
    process.exitCode = 1;
  }
}
