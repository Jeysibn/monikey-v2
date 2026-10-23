import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { releaseImages } from "./verify-release-manifest.mjs";
import {
  assertOutputOutsideGitCheckouts,
  assertRenderedImages,
  createImageTransform,
  verifyReleaseCheckout,
} from "./render-release-manifests.mjs";

const images = Object.fromEntries(
  releaseImages.map((name, index) => [
    name,
    `ghcr.io/jeysibn/monikey-v2-${name}@sha256:${String(index + 1).repeat(64)}`,
  ]),
);

test("creates digest-only Kustomize image overrides for all release images", () => {
  const transform = createImageTransform(images);
  for (const name of releaseImages) {
    assert.match(transform, new RegExp(`name: ${images[name].split("@")[0]}`));
    assert.match(
      transform,
      new RegExp(
        `digest: sha256:${String(releaseImages.indexOf(name) + 1).repeat(64)}`,
      ),
    );
  }
  assert.equal((transform.match(/ {2}- name:/g) ?? []).length, 6);
});

test("accepts six pinned release images across seven workload references", () => {
  const rendered = releaseImages
    .flatMap((name, index) =>
      Array.from({ length: name === "backup" ? 2 : 1 }, () =>
        index % 2 === 0
          ? `          image: ${images[name]}`
          : `          - image: ${images[name]}`,
      ),
    )
    .join("\n");
  assert.doesNotThrow(() => assertRenderedImages(rendered, images));
  assert.throws(
    () =>
      assertRenderedImages(
        rendered.replace(images.web, "ghcr.io/jeysibn/monikey-v2-web:latest"),
        images,
      ),
    /does not pin exactly 1 web image reference/,
  );
  assert.throws(
    () => assertRenderedImages(`${rendered}\nimage: alpine:latest`, images),
    /exactly 7 container image references/,
  );
  assert.throws(
    () =>
      assertRenderedImages(
        rendered.replace(
          images.backup,
          "ghcr.io/jeysibn/monikey-v2-backup:latest",
        ),
        images,
      ),
    /exactly 2 backup image references/,
  );
});

test("requires a clean checkout at the release source commit", () => {
  const sourceSha = "a".repeat(40);
  assert.doesNotThrow(() =>
    verifyReleaseCheckout({
      expectedSourceSha: sourceSha,
      actualSourceSha: sourceSha,
      worktreeStatus: "",
    }),
  );
  assert.throws(
    () =>
      verifyReleaseCheckout({
        expectedSourceSha: sourceSha,
        actualSourceSha: "b".repeat(40),
        worktreeStatus: "",
      }),
    /does not match the release source commit/,
  );
  assert.throws(
    () =>
      verifyReleaseCheckout({
        expectedSourceSha: sourceSha,
        actualSourceSha: sourceSha,
        worktreeStatus: " M deploy/kubernetes/app/api.yaml",
      }),
    /requires a clean Git worktree/,
  );
});

test("refuses output paths inside any Git worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "monikey-render-output-"));
  const alias = join(tmpdir(), `monikey-render-link-${process.pid}`);
  try {
    await mkdir(join(root, ".git"));
    await symlink(root, alias, "dir");
    await assert.rejects(
      assertOutputOutsideGitCheckouts(join(root, "review", "candidate.yaml")),
      /outside all Git worktrees/,
    );
    await assert.rejects(
      assertOutputOutsideGitCheckouts(join(alias, "candidate.yaml")),
      /outside all Git worktrees/,
    );
    await assert.doesNotReject(
      assertOutputOutsideGitCheckouts(join(tmpdir(), "candidate.yaml")),
    );
  } finally {
    await rm(alias, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
