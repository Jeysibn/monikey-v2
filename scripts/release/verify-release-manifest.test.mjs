import assert from "node:assert/strict";
import test from "node:test";
import { getPrismaSchemaVersion } from "../database/prisma-schema-version.mjs";

import {
  releaseImages,
  verifyReleaseManifest,
} from "./verify-release-manifest.mjs";

const sourceSha = "a".repeat(40);
const prHead = "b".repeat(40);
const repository = "Jeysibn/monikey-v2";
const schemaVersion = await getPrismaSchemaVersion();

function manifest(overrides = {}) {
  const values = {
    source_commit: sourceSha,
    migration_schema_version: schemaVersion,
    validated_pr: "57",
    validated_pr_head: prHead,
    ...Object.fromEntries(
      releaseImages.map((image, index) => [
        image,
        `ghcr.io/jeysibn/monikey-v2-${image}@sha256:${String(index + 1).repeat(64)}`,
      ]),
    ),
    ...overrides,
  };
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function verify(content = manifest(), expectedSha = sourceSha) {
  return verifyReleaseManifest({
    content,
    repository,
    sourceSha: expectedSha,
    expectedSchemaVersion: schemaVersion,
    expectedPullRequest: "57",
    expectedPullRequestHead: prHead,
  });
}

test("accepts the complete six-image immutable digest map for the source SHA", () => {
  assert.deepEqual(verify(), {
    sourceCommit: sourceSha,
    migrationSchemaVersion: schemaVersion,
    validatedPullRequest: 57,
    imageCount: 6,
    images: Object.fromEntries(
      releaseImages.map((image, index) => [
        image,
        `ghcr.io/jeysibn/monikey-v2-${image}@sha256:${String(index + 1).repeat(64)}`,
      ]),
    ),
  });
});

test("rejects a missing or duplicate image entry", () => {
  assert.throws(
    () => verify(manifest().replace(/\nbackup=[^\n]*/, "")),
    /missing manifest key: backup/,
  );
  assert.throws(
    () =>
      verify(
        `${manifest()}\nweb=ghcr.io/jeysibn/monikey-v2-web@sha256:${"c".repeat(64)}`,
      ),
    /duplicate manifest key: web/,
  );
});

test("rejects mutable tags, wrong repositories, and malformed digests", () => {
  for (const badImage of [
    "ghcr.io/jeysibn/monikey-v2-web:latest",
    `ghcr.io/other/monikey-v2-web@sha256:${"c".repeat(64)}`,
    `ghcr.io/jeysibn/monikey-v2-web@sha256:${"c".repeat(63)}`,
  ]) {
    assert.throws(
      () => verify(manifest({ web: badImage })),
      /web must use ghcr\.io\/jeysibn\/monikey-v2-web/,
    );
  }
});

test("rejects source SHA mismatch and malformed PR metadata", () => {
  assert.throws(() => verify(manifest(), "c".repeat(40)), /source commit/);
  assert.throws(
    () => verify(manifest({ validated_pr: "0" })),
    /positive PR number/,
  );
  assert.throws(
    () => verify(manifest({ validated_pr_head: "not-a-sha" })),
    /full commit SHA/,
  );
});

test("requires PR metadata to match the earlier release verifier output", () => {
  assert.throws(
    () => verify(manifest({ validated_pr: "58" })),
    /PR number does not match/,
  );
  assert.throws(
    () => verify(manifest({ validated_pr_head: "c".repeat(40) })),
    /PR head does not match/,
  );
});

test("requires the manifest to record the exact source migration version", () => {
  assert.throws(
    () => verify(manifest({ migration_schema_version: "20261022000000_old" })),
    /schema version does not match/,
  );
  assert.throws(
    () =>
      verify(
        manifest().replace(`migration_schema_version=${schemaVersion}\n`, ""),
      ),
    /missing manifest key: migration_schema_version/,
  );
});
