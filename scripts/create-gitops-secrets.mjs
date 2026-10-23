#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const recipient = process.env.SOPS_AGE_RECIPIENTS?.trim();
if (!recipient || !/^age1[0-9a-z]{20,}$/.test(recipient)) {
  console.error(
    "Set SOPS_AGE_RECIPIENTS to the owner-approved public age recipient (never a private key).",
  );
  process.exit(2);
}

const output = resolve(
  process.argv[2] ?? "deploy/kubernetes/secrets/runtime.enc.yaml",
);
let privateTempDir;
const password = randomBytes(32).toString("hex");
const secrets = `apiVersion: v1
kind: Secret
metadata:
  name: monikey-v2-runtime-secrets
  namespace: monikey-v2
type: Opaque
stringData:
  POSTGRES_PASSWORD: ${password}
  DATABASE_URL: postgresql://monikey_v2:${password}@postgres:5432/monikey_v2?schema=public
---
apiVersion: v1
kind: Secret
metadata:
  name: monikey-v2-postgres-client
  namespace: monikey-v2
type: Opaque
stringData:
  host: postgres
  database: monikey_v2
  username: monikey_v2
  password: ${password}
`;

try {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  try {
    await access(output);
    throw new Error(`refusing to overwrite existing output ${output}`);
  } catch (error) {
    if (
      error instanceof Error &&
      !("code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  privateTempDir = await mkdtemp(join(tmpdir(), "monikey-sops-"));
  await chmod(privateTempDir, 0o700);
  const plaintextFile = join(privateTempDir, "runtime.yaml");
  await writeFile(plaintextFile, secrets, { mode: 0o600, flag: "wx" });
  const result = spawnSync(
    "sops",
    [
      "--encrypt",
      "--age",
      recipient,
      "--encrypted-regex",
      "^(stringData)$",
      "--input-type",
      "yaml",
      "--output-type",
      "yaml",
      plaintextFile,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const outcome = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status ?? "unknown"}`;
    throw new Error(`SOPS encryption failed with ${outcome}`);
  }
  await writeFile(output, result.stdout, { mode: 0o600, flag: "wx" });
  console.log(`Wrote age-encrypted Kubernetes secrets to ${output}`);
} catch (error) {
  console.error(
    `Could not create encrypted secrets: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  if (privateTempDir)
    await rm(privateTempDir, { recursive: true, force: true });
}
