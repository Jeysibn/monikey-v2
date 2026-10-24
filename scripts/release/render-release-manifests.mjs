import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getPrismaSchemaVersion } from "../database/prisma-schema-version.mjs";
import {
  releaseImages,
  verifyReleaseManifest,
} from "./verify-release-manifest.mjs";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);
const kubernetesRoot = join(repositoryRoot, "deploy", "kubernetes");
const releaseImageReferenceCounts = {
  web: 1,
  api: 1,
  migration: 1,
  postgres: 1,
  backup: 2,
  "backup-metrics": 1,
};

export function verifyReleaseCheckout({
  expectedSourceSha,
  actualSourceSha,
  worktreeStatus,
}) {
  if (!/^[a-f0-9]{40}$/i.test(actualSourceSha ?? "")) {
    throw new Error("current Git checkout must resolve to a full commit SHA");
  }
  if (actualSourceSha.toLowerCase() !== expectedSourceSha?.toLowerCase()) {
    throw new Error(
      "current Git checkout does not match the release source commit",
    );
  }
  if (worktreeStatus !== "") {
    throw new Error("release rendering requires a clean Git worktree");
  }
}

export async function assertOutputOutsideGitCheckouts(outputPath) {
  let current = dirname(resolve(outputPath));
  while (true) {
    try {
      current = await realpath(current);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  while (true) {
    let isGitCheckout = false;
    try {
      await lstat(join(current, ".git"));
      isGitCheckout = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (isGitCheckout) {
      throw new Error(
        "rendered manifest output must be outside all Git worktrees",
      );
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function createImageTransform(images) {
  const entries = releaseImages.map((name) => {
    const image = images[name];
    if (typeof image !== "string") {
      throw new Error(`release manifest has no verified image for ${name}`);
    }
    const [repository, digest, extra] = image.split("@");
    if (!repository || !digest || extra !== undefined) {
      throw new Error(`release image coordinate is malformed for ${name}`);
    }
    return [
      `  - name: ${repository}`,
      `    newName: ${repository}`,
      `    digest: ${digest}`,
    ].join("\n");
  });
  return `images:\n${entries.join("\n")}\n`;
}

export function assertRenderedImages(rendered, images) {
  const actual = [
    ...rendered.matchAll(/^[ \t]*(?:-[ \t]*)?image:[ \t]*(\S+)[ \t]*$/gm),
  ].map((match) => match[1]);
  const expectedReferenceCount = Object.values(
    releaseImageReferenceCounts,
  ).reduce((sum, count) => sum + count, 0);
  if (actual.length !== expectedReferenceCount) {
    throw new Error(
      `rendered manifest must contain exactly ${expectedReferenceCount} container image references; found ${actual.length}`,
    );
  }
  for (const name of releaseImages) {
    const expected = images[name];
    const expectedCount = releaseImageReferenceCounts[name];
    if (actual.filter((image) => image === expected).length !== expectedCount) {
      throw new Error(
        `rendered manifest does not pin exactly ${expectedCount} ${name} image reference${expectedCount === 1 ? "" : "s"}`,
      );
    }
  }
  if (actual.some((image) => image.includes("REPLACE_WITH_PUBLISHED_DIGEST"))) {
    throw new Error("rendered manifest contains a release placeholder");
  }
}

export async function renderReleaseManifest({
  manifestContent,
  repository,
  sourceSha,
  expectedPullRequest,
  expectedPullRequestHead,
  releaseCheckout,
  outputPath,
  kustomizeBinary = "kustomize",
}) {
  const validation = verifyReleaseManifest({
    content: manifestContent,
    repository,
    sourceSha,
    expectedSchemaVersion: await getPrismaSchemaVersion(),
    expectedPullRequest,
    expectedPullRequestHead,
  });
  verifyReleaseCheckout({
    expectedSourceSha: validation.sourceCommit,
    ...releaseCheckout,
  });
  if (!outputPath) {
    throw new Error("RENDERED_MANIFEST_OUTPUT is required");
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "monikey-v2-release-render-"),
  );
  try {
    const copiedRoot = join(temporaryRoot, "kubernetes");
    await cp(kubernetesRoot, copiedRoot, { recursive: true });
    const kustomizationPath = join(copiedRoot, "kustomization.yaml");
    const base = await readFile(kustomizationPath, "utf8");
    await writeFile(
      kustomizationPath,
      `${base.trimEnd()}\n${createImageTransform(validation.images)}`,
      "utf8",
    );

    const result = spawnSync(kustomizeBinary, ["build", copiedRoot], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`kustomize build failed: ${result.stderr.trim()}`);
    }
    assertRenderedImages(result.stdout, validation.images);

    const destination = resolve(outputPath);
    await assertOutputOutsideGitCheckouts(destination);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, result.stdout, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    return {
      ...validation,
      outputPath: destination,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const manifestPath = process.env.RELEASE_MANIFEST;
  if (!manifestPath) throw new Error("RELEASE_MANIFEST is required");
  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (gitHead.error) throw gitHead.error;
  if (gitHead.status !== 0) {
    throw new Error(
      `could not resolve current Git HEAD: ${gitHead.stderr.trim()}`,
    );
  }
  const gitStatus = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (gitStatus.error) throw gitStatus.error;
  if (gitStatus.status !== 0) {
    throw new Error(
      `could not inspect Git worktree: ${gitStatus.stderr.trim()}`,
    );
  }
  const result = await renderReleaseManifest({
    manifestContent: await readFile(manifestPath, "utf8"),
    repository: process.env.GITHUB_REPOSITORY,
    sourceSha: process.env.GITHUB_SHA,
    expectedPullRequest: process.env.VALIDATED_PR,
    expectedPullRequestHead: process.env.VALIDATED_PR_HEAD,
    releaseCheckout: {
      actualSourceSha: gitHead.stdout.trim(),
      worktreeStatus: gitStatus.stdout,
    },
    outputPath: process.env.RENDERED_MANIFEST_OUTPUT,
    kustomizeBinary: process.env.KUSTOMIZE_BIN ?? "kustomize",
  });
  console.log(
    `Rendered ${result.imageCount} verified image digests for ${result.sourceCommit} (schema ${result.migrationSchemaVersion}) to ${result.outputPath}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `Release manifest rendering failed: ${error instanceof Error ? error.message : "unexpected rendering error"}`,
    );
    process.exitCode = 1;
  });
}
