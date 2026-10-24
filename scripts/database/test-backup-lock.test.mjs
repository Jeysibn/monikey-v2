import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

test("backup acquires a nonblocking PVC lock before reading or mutating run state", async () => {
  const script = await readFile(
    join(repositoryRoot, "deploy/kubernetes/backup/pg-backup-rotate.sh"),
    "utf8",
  );
  const lockIndex = script.indexOf('exec 9>>"$BACKUP_ROOT/.backup.lock"');
  const flockIndex = script.indexOf("if ! flock -n 9; then", lockIndex);
  const stateReadIndex = script.indexOf('STATE_FILE="$BACKUP_ROOT/.state"');
  const metricsWriteIndex = script.indexOf("write_metrics 0\nrun_started=");

  assert.notEqual(lockIndex, -1);
  assert.ok(flockIndex > lockIndex);
  assert.ok(stateReadIndex > flockIndex);
  assert.ok(metricsWriteIndex > flockIndex);
  assert.match(script, /backup_status=failed stage=already_running/);
  assert.match(
    await readFile(join(repositoryRoot, "apps/api/Dockerfile.backup"), "utf8"),
    /command -v flock/,
  );
});
