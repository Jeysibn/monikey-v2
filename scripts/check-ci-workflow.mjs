import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

const workflowPath = ".github/workflows/ci.yml";

export function validateCiWorkflow(source) {
  const document = parseDocument(source, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, "workflow YAML must parse cleanly");
  const workflow = document.toJS();

  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "pull_request",
    "workflow_dispatch",
  ]);
  assert.deepEqual(workflow.on.pull_request.branches, ["dev", "main"]);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.publish_images.type,
    "boolean",
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.publish_images.required,
    true,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.publish_images.default,
    false,
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const jobs = workflow.jobs;
  assert.deepEqual(Object.keys(jobs).sort(), [
    "codeql",
    "e2e",
    "publish-images",
    "validate",
  ]);
  for (const jobName of ["validate", "e2e", "codeql"]) {
    assert.equal(
      jobs[jobName].if,
      "github.event_name == 'pull_request'",
      `${jobName} must run only for pull requests`,
    );
    assert.notEqual(
      jobs[jobName].permissions?.packages,
      "write",
      `${jobName} must not receive package write access`,
    );
  }

  const validateRuns = jobs.validate.steps
    .filter((step) => typeof step.run === "string")
    .map((step) => step.run);
  assert.ok(validateRuns.some((run) => run.includes("npm ci")));
  assert.ok(validateRuns.some((run) => run.includes("npm run validate")));

  const e2eRuns = jobs.e2e.steps
    .filter((step) => typeof step.run === "string")
    .map((step) => step.run);
  assert.ok(
    e2eRuns.some((run) => run.includes("npm run test:integration")),
    "the PR E2E job must run all PostgreSQL integration suites",
  );
  assert.ok(
    e2eRuns.some((run) => run.includes("npm run test:e2e")),
    "the PR E2E job must run API-backed Playwright",
  );
  assert.ok(
    e2eRuns.some((run) => run.includes("docker compose up --build -d --wait")),
  );
  assert.ok(
    jobs.e2e.steps.some(
      (step) =>
        step.if === "always()" &&
        step.run?.includes("docker compose down --volumes --remove-orphans"),
    ),
  );

  for (const jobName of ["validate", "codeql"]) {
    for (const step of jobs[jobName].steps) {
      if (!step.uses) continue;
      assert.match(
        step.uses,
        /^[^@]+@[a-f0-9]{40}(?:\s+#.*)?$/,
        `${jobName} action references must be pinned to commit SHAs`,
      );
    }
  }

  const publisher = jobs["publish-images"];
  assert.match(publisher.if, /github\.event_name == 'workflow_dispatch'/);
  assert.match(publisher.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publisher.if, /inputs\.publish_images/);
  assert.deepEqual(publisher.permissions, {
    contents: "read",
    checks: "read",
    "pull-requests": "read",
    packages: "write",
  });

  const steps = publisher.steps;
  const verifyIndex = steps.findIndex(
    (step) => step.name === "Verify the main merge and required PR checks",
  );
  const buildIndex = steps.findIndex(
    (step) =>
      step.name === "Build all release images with the source commit label",
  );
  const scanIndex = steps.findIndex(
    (step) => step.name === "Scan every local image before publication",
  );
  const publishIndex = steps.findIndex(
    (step) => step.name === "Publish and scan immutable registry digests",
  );
  assert.ok(verifyIndex >= 0 && verifyIndex < buildIndex);
  assert.ok(buildIndex < scanIndex && scanIndex < publishIndex);
  assert.equal(
    steps[verifyIndex].env.GITHUB_TOKEN,
    "${{ secrets.GITHUB_TOKEN }}",
  );
  assert.equal(
    steps[publishIndex].env.GITHUB_TOKEN,
    "${{ secrets.GITHUB_TOKEN }}",
  );

  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = await readFile(workflowPath, "utf8");
  validateCiWorkflow(source);
  console.log("CI workflow YAML and release gates are valid.");
}
