import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const generator = join(repositoryRoot, "scripts/create-gitops-secrets.mjs");
const publicRecipient = `age1${"a".repeat(32)}`;

async function createSopsStub(root) {
  const binDirectory = join(root, "bin");
  await mkdir(binDirectory);
  const sopsPath = join(binDirectory, "sops");
  const stub = `#!/bin/sh
set -eu
last_arg=
for arg in "$@"; do last_arg=$arg; done
test -f "$last_arg"
test "$(stat -c %a "$(dirname "$last_arg")")" = 700
test "$(stat -c %a "$last_arg")" = 600
grep -q '^  POSTGRES_PASSWORD:' "$last_arg"
grep -q '^  DATABASE_URL:' "$last_arg"
grep -q '^  password:' "$last_arg"
printf '%s\\n' "$last_arg" > "$SOPS_TEST_INPUT_PATH_FILE"
case " $* " in *" --age $SOPS_AGE_RECIPIENTS "*) ;; *) exit 41 ;; esac
if [ "$SOPS_TEST_FAIL" = true ]; then
  echo 'FAKE_SECRET_SENTINEL from SOPS failure' >&2
  exit 42
fi
printf 'apiVersion: v1\\nsops:\\n  age:\\n    - recipient: test-public-recipient\\n'
`;
  await writeFile(sopsPath, stub, { mode: 0o700 });
  await chmod(sopsPath, 0o700);
  return binDirectory;
}

function runGenerator({
  output,
  binDirectory,
  inputPathFile,
  fail = false,
  recipient = publicRecipient,
}) {
  return spawnSync(process.execPath, [generator, output], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      SOPS_AGE_RECIPIENTS: recipient,
      SOPS_TEST_INPUT_PATH_FILE: inputPathFile,
      SOPS_TEST_FAIL: String(fail),
    },
  });
}

test("writes only encrypted output and removes the mode-restricted plaintext temp file", async () => {
  const root = await mkdtemp(join(tmpdir(), "monikey-secrets-success-"));
  try {
    const binDirectory = await createSopsStub(root);
    const output = join(root, "private", "runtime.enc.yaml");
    const inputPathFile = join(root, "sops-input-path");
    const result = runGenerator({ output, binDirectory, inputPathFile });

    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(output, "utf8"), /test-public-recipient/);
    assert.doesNotMatch(
      await readFile(output, "utf8"),
      /POSTGRES_PASSWORD|DATABASE_URL/,
    );
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /POSTGRES_PASSWORD|DATABASE_URL/,
    );

    const plaintextPath = (await readFile(inputPathFile, "utf8")).trim();
    await assert.rejects(stat(plaintextPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes plaintext and does not create output when SOPS fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "monikey-secrets-failure-"));
  try {
    const binDirectory = await createSopsStub(root);
    const output = join(root, "runtime.enc.yaml");
    const inputPathFile = join(root, "sops-input-path");
    const result = runGenerator({
      output,
      binDirectory,
      inputPathFile,
      fail: true,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /SOPS encryption failed with exit code 42/);
    assert.doesNotMatch(result.stderr, /FAKE_SECRET_SENTINEL/);
    await assert.rejects(stat(output), { code: "ENOENT" });
    const plaintextPath = (await readFile(inputPathFile, "utf8")).trim();
    await assert.rejects(stat(plaintextPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a missing or malformed age recipient before invoking SOPS", async () => {
  const root = await mkdtemp(join(tmpdir(), "monikey-secrets-recipient-"));
  try {
    const binDirectory = await createSopsStub(root);
    const output = join(root, "runtime.enc.yaml");
    const inputPathFile = join(root, "sops-input-path");
    const result = runGenerator({
      output,
      binDirectory,
      inputPathFile,
      recipient: "not-a-public-age-recipient",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /owner-approved public age recipient/);
    await assert.rejects(stat(output), { code: "ENOENT" });
    await assert.rejects(stat(inputPathFile), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to overwrite existing ciphertext without invoking SOPS", async () => {
  const root = await mkdtemp(join(tmpdir(), "monikey-secrets-overwrite-"));
  try {
    const binDirectory = await createSopsStub(root);
    const output = join(root, "runtime.enc.yaml");
    const inputPathFile = join(root, "sops-input-path");
    await writeFile(output, "existing-ciphertext\n", { mode: 0o600 });
    const result = runGenerator({ output, binDirectory, inputPathFile });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to overwrite existing output/);
    assert.equal(await readFile(output, "utf8"), "existing-ciphertext\n");
    await assert.rejects(stat(inputPathFile), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
