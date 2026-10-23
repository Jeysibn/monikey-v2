import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = join(repositoryRoot, "scripts", "secret-scan.mjs");

function git(directory, ...args) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initializeFixture() {
  const directory = mkdtempSync(join(tmpdir(), "monikey-secret-scan-"));
  git(directory, "init", "-q");
  git(directory, "config", "user.email", "fixture@example.test");
  git(directory, "config", "user.name", "Disposable Fixture");
  return directory;
}

function commitFile(directory, path, contents, message) {
  const absolutePath = join(directory, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
  git(directory, "add", path);
  git(directory, "commit", "-qm", message);
}

function runScanner(directory) {
  return spawnSync(process.execPath, [scannerPath], {
    cwd: directory,
    encoding: "utf8",
  });
}

test("rejects a removed historical token and redacts the matched value", (t) => {
  const directory = initializeFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const syntheticToken = `ghp_${"A".repeat(36)}`;
  commitFile(
    directory,
    "config.txt",
    `token=${syntheticToken}\n`,
    "fixture token",
  );
  commitFile(
    directory,
    "config.txt",
    "token=removed\n",
    "remove fixture token",
  );

  const result = runScanner(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\.txt: GitHub token/);
  assert.doesNotMatch(result.stderr, new RegExp(syntheticToken));
});

test("allows documented inert local database credentials", (t) => {
  const directory = initializeFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  commitFile(
    directory,
    "compose.txt",
    "postgresql://monikey:test-only@localhost/monikey_e2e\n",
    "fixture placeholder",
  );

  const result = runScanner(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Secret scan passed/);
});

test("rejects an uncommitted token in a tracked worktree file", (t) => {
  const directory = initializeFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  commitFile(directory, "config.txt", "safe=true\n", "safe baseline");
  const syntheticToken = `ghp_${"B".repeat(36)}`;
  writeFileSync(join(directory, "config.txt"), `token=${syntheticToken}\n`);

  const result = runScanner(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\.txt: GitHub token/);
  assert.doesNotMatch(result.stderr, new RegExp(syntheticToken));
});
