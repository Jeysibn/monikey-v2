import { readFile } from "node:fs/promises";
import { getPrismaSchemaVersion } from "../database/prisma-schema-version.mjs";

export const releaseImages = [
  "web",
  "api",
  "migration",
  "postgres",
  "backup",
  "backup-metrics",
];

const shaPattern = /^[a-f0-9]{40}$/i;
const digestPattern = /^sha256:[a-f0-9]{64}$/i;

export function verifyReleaseManifest({
  content,
  repository,
  sourceSha,
  expectedSchemaVersion,
  expectedPullRequest,
  expectedPullRequestHead,
}) {
  if (!/^[^/]+\/[^/]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_REPOSITORY must be owner/repository");
  }
  if (!shaPattern.test(sourceSha ?? "")) {
    throw new Error("GITHUB_SHA must be a full commit SHA");
  }
  if (!/^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(expectedSchemaVersion ?? "")) {
    throw new Error("expected Prisma schema version is invalid");
  }
  if (!/^[1-9][0-9]*$/.test(expectedPullRequest ?? "")) {
    throw new Error("verified PR output must be a positive PR number");
  }
  if (!shaPattern.test(expectedPullRequestHead ?? "")) {
    throw new Error("verified PR head output must be a full commit SHA");
  }

  const values = new Map();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new Error(`invalid manifest line ${index + 1}`);
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!value || values.has(key)) {
      throw new Error(`empty or duplicate manifest key: ${key}`);
    }
    values.set(key, value);
  }

  const expectedKeys = new Set([
    "source_commit",
    "migration_schema_version",
    "validated_pr",
    "validated_pr_head",
    ...releaseImages,
  ]);
  for (const key of values.keys()) {
    if (!expectedKeys.has(key)) {
      throw new Error(`unexpected manifest key: ${key}`);
    }
  }
  for (const key of expectedKeys) {
    if (!values.has(key)) {
      throw new Error(`missing manifest key: ${key}`);
    }
  }

  if (values.get("source_commit").toLowerCase() !== sourceSha.toLowerCase()) {
    throw new Error("manifest source commit does not match GITHUB_SHA");
  }
  if (values.get("migration_schema_version") !== expectedSchemaVersion) {
    throw new Error(
      "manifest Prisma schema version does not match the source migrations",
    );
  }
  if (!/^[1-9][0-9]*$/.test(values.get("validated_pr"))) {
    throw new Error("validated_pr must be a positive PR number");
  }
  if (values.get("validated_pr") !== expectedPullRequest) {
    throw new Error("manifest PR number does not match the verified PR output");
  }
  if (!shaPattern.test(values.get("validated_pr_head"))) {
    throw new Error("validated_pr_head must be a full commit SHA");
  }
  if (
    values.get("validated_pr_head").toLowerCase() !==
    expectedPullRequestHead.toLowerCase()
  ) {
    throw new Error("manifest PR head does not match the verified PR output");
  }

  const owner = repository.split("/")[0].toLowerCase();
  for (const image of releaseImages) {
    const expectedRepository = `ghcr.io/${owner}/monikey-v2-${image}`;
    const value = values.get(image);
    const [actualRepository, digest, extra] = value.split("@");
    if (
      extra !== undefined ||
      actualRepository !== expectedRepository ||
      !digestPattern.test(digest ?? "")
    ) {
      throw new Error(
        `${image} must use ${expectedRepository}@sha256:<64 hex characters>`,
      );
    }
  }

  return {
    sourceCommit: sourceSha,
    migrationSchemaVersion: expectedSchemaVersion,
    validatedPullRequest: Number(values.get("validated_pr")),
    imageCount: releaseImages.length,
    images: Object.fromEntries(
      releaseImages.map((image) => [image, values.get(image)]),
    ),
  };
}

async function main() {
  const manifestPath = process.env.RELEASE_MANIFEST;
  const repository = process.env.GITHUB_REPOSITORY;
  const sourceSha = process.env.GITHUB_SHA;
  const expectedSchemaVersion = await getPrismaSchemaVersion();
  const expectedPullRequest = process.env.VALIDATED_PR;
  const expectedPullRequestHead = process.env.VALIDATED_PR_HEAD;
  if (!manifestPath) throw new Error("RELEASE_MANIFEST is required");
  const content = await readFile(manifestPath, "utf8");
  const result = verifyReleaseManifest({
    content,
    repository,
    sourceSha,
    expectedSchemaVersion,
    expectedPullRequest,
    expectedPullRequestHead,
  });
  console.log(
    `Verified ${result.imageCount} immutable image digests for ${result.sourceCommit} from PR #${result.validatedPullRequest}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main().catch((error) => {
    console.error(
      `Release manifest verification failed: ${error instanceof Error ? error.message : "unexpected verification error"}`,
    );
    process.exitCode = 1;
  });
}
