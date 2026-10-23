import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCiWorkflow } from "./check-ci-workflow.mjs";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");

test("accepts one PR validation job and the gated main publisher", () => {
  assert.equal(validateCiWorkflow(workflow), true);
});

test("rejects push triggers that duplicate PR validation", () => {
  const changed = workflow.replace(
    "on:\n  pull_request:",
    "on:\n  push:\n    branches: [dev, main]\n  pull_request:",
  );
  assert.throws(() => validateCiWorkflow(changed), /deep-equal/);
});

test("rejects image publishing without an explicit main dispatch gate", () => {
  const changed = workflow.replace(
    "github.ref == 'refs/heads/main' &&",
    "github.ref == 'refs/heads/dev' &&",
  );
  assert.throws(
    () => validateCiWorkflow(changed),
    (error) =>
      error instanceof Error && error.message.includes("refs/heads/dev"),
  );
});

test("rejects broad publisher permissions", () => {
  const changed = workflow.replace(
    "      packages: write\n    steps:",
    "      packages: write\n      security-events: write\n    steps:",
  );
  assert.throws(() => validateCiWorkflow(changed), /deep-equal/);
});

test("rejects publishing before local image scans", () => {
  const changed = workflow.replace(
    "      - name: Scan every local image before publication",
    "      - name: Publish and scan immutable registry digests\n        id: release\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n          IMAGE_TAG: sha-${{ github.sha }}\n          VALIDATED_PR: ${{ steps.verify.outputs.pull_request }}\n          VALIDATED_PR_HEAD: ${{ steps.verify.outputs.pull_request_head }}\n        run: echo publish\n      - name: Scan every local image before publication",
  );
  assert.throws(() => validateCiWorkflow(changed), /buildIndex < scanIndex/);
});

test("rejects malformed workflow YAML", () => {
  assert.throws(
    () => validateCiWorkflow("name: [broken"),
    /must parse cleanly/,
  );
});

test("rejects unpinned validation actions", () => {
  const changed = workflow.replace(
    "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "actions/checkout@main",
  );
  assert.throws(
    () => validateCiWorkflow(changed),
    (error) =>
      error instanceof Error &&
      error.message.includes("action references must be pinned to commit SHAs"),
  );
});
