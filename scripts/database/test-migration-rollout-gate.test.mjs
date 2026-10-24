import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(path) {
  return readFile(join(root, path), "utf8");
}

function resourceDocument(content, kind, name) {
  const documents = content.split(/^---\s*$/m);
  const document = documents.find(
    (entry) =>
      new RegExp(`^kind: ${kind}$`, "m").test(entry) &&
      new RegExp(`^  name: ${name}$`, "m").test(entry),
  );
  assert.ok(document, `missing ${kind} ${name}`);
  return document;
}

function syncWave(document) {
  const wave = document.match(
    /argocd\.argoproj\.io\/sync-wave: ["']?(\d+)["']?/,
  );
  assert.ok(wave, "resource must declare an Argo sync wave");
  return Number(wave[1]);
}

test("sync waves take PostgreSQL through backup and migration before application", async () => {
  const postgres = await source("deploy/kubernetes/app/postgres.yaml");
  const preMigrationBackup = await source(
    "deploy/kubernetes/backup/pre-migration-job.yaml",
  );
  const migration = await source("deploy/kubernetes/migration/job.yaml");
  const api = await source("deploy/kubernetes/app/api.yaml");
  const web = await source("deploy/kubernetes/app/web.yaml");
  const ingress = await source("deploy/kubernetes/cutover/ingress.yaml");

  const waves = [
    syncWave(resourceDocument(postgres, "StatefulSet", "monikey-v2-postgres")),
    syncWave(
      resourceDocument(
        preMigrationBackup,
        "Job",
        "monikey-v2-pre-migration-backup",
      ),
    ),
    syncWave(resourceDocument(migration, "Job", "monikey-v2-migrate")),
    syncWave(resourceDocument(api, "Deployment", "monikey-v2-api")),
    syncWave(resourceDocument(web, "Deployment", "monikey-v2-web")),
    syncWave(resourceDocument(ingress, "Ingress", "monikey-v2")),
  ];

  assert.deepEqual(waves, [0, 1, 2, 3, 4, 6]);
  assert.match(preMigrationBackup, /argocd\.argoproj\.io\/hook: Sync/);
  assert.match(migration, /argocd\.argoproj\.io\/hook: Sync/);
});

test("backup hook shares the protected PVC, secret, image and DB network identity", async () => {
  const backupJob = await source(
    "deploy/kubernetes/backup/pre-migration-job.yaml",
  );
  const backupNetworkPolicy = await source(
    "deploy/kubernetes/network/backup.yaml",
  );
  const postgresNetworkPolicy = await source(
    "deploy/kubernetes/network/postgres.yaml",
  );
  const rootKustomization = await source(
    "deploy/kubernetes/kustomization.yaml",
  );
  const backupKustomization = await source(
    "deploy/kubernetes/backup/kustomization.yaml",
  );

  assert.match(rootKustomization, /^\s*- backup\s*$/m);
  assert.match(backupKustomization, /^\s*- pre-migration-job\.yaml\s*$/m);
  assert.match(
    backupJob,
    /app\.kubernetes\.io\/name: monikey-v2-postgres-backup/,
  );
  assert.match(
    backupNetworkPolicy,
    /app\.kubernetes\.io\/name: monikey-v2-postgres-backup/,
  );
  assert.match(
    postgresNetworkPolicy,
    /app\.kubernetes\.io\/name: monikey-v2-postgres-backup/,
  );
  assert.match(backupJob, /monikey-v2-postgres-client/);
  assert.match(backupJob, /claimName: monikey-v2-backups/);
  assert.match(backupJob, /ghcr\.io\/jeysibn\/monikey-v2-backup:/);
  assert.match(backupJob, /activeDeadlineSeconds: 7200/);
  assert.match(backupJob, /automountServiceAccountToken: false/);
  assert.match(backupJob, /readOnlyRootFilesystem: true/);
  assert.match(backupJob, /drop: \["ALL"\]/);
});

test("migration hook is bounded and fails closed on missing database credentials", async () => {
  const migration = await source("deploy/kubernetes/migration/job.yaml");
  const document = resourceDocument(migration, "Job", "monikey-v2-migrate");

  assert.match(document, /backoffLimit: 0/);
  assert.match(document, /activeDeadlineSeconds: 900/);
  assert.match(document, /restartPolicy: Never/);
  assert.match(
    document,
    /argocd\.argoproj\.io\/hook-delete-policy: BeforeHookCreation/,
  );
  assert.match(document, /name: DATABASE_URL[\s\S]*?secretKeyRef:/);
  assert.match(
    document,
    /secretKeyRef:[\s\S]*?name: monikey-v2-runtime-secrets[\s\S]*?key: DATABASE_URL/,
  );
  assert.doesNotMatch(document, /optional: true/);
});
