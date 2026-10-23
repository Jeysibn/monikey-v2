import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./verify-release-main.mjs", import.meta.url),
);
const repository = "owner/repo";
const sourceSha = "a".repeat(40);
const headSha = "b".repeat(40);

function check(name, conclusion, completedAt) {
  return {
    name,
    status: "completed",
    conclusion,
    created_at: completedAt,
    started_at: completedAt,
    completed_at: completedAt,
  };
}

function mergedPullRequest(mergeCommitSha = sourceSha) {
  return {
    number: 57,
    base: { ref: "main" },
    merged_at: "2026-10-23T00:00:00Z",
    merge_commit_sha: mergeCommitSha,
    head: { sha: headSha },
  };
}

async function runVerifier({ pullRequests, checkPages, outputFile } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const url = new URL(request.url, "http://127.0.0.1");
    let body;
    if (url.pathname.endsWith(`/commits/${sourceSha}/pulls`)) {
      body = pullRequests ?? [mergedPullRequest()];
    } else if (url.pathname.endsWith(`/commits/${headSha}/check-runs`)) {
      const page = Number(url.searchParams.get("page") ?? 1);
      body = { check_runs: checkPages?.[page] ?? [] };
    } else {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const env = {
    ...process.env,
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sourceSha,
    GITHUB_REF: "refs/heads/main",
    GITHUB_TOKEN: "test-token",
    GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
  };
  if (outputFile) env.GITHUB_OUTPUT = outputFile;
  else delete env.GITHUB_OUTPUT;

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    return { ...result, requests };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("accepts the exact merged main commit and paginated successful checks", async () => {
  const earlier = "2026-10-23T01:00:00Z";
  const later = "2026-10-23T02:00:00Z";
  const checkPages = {
    1: Array.from({ length: 100 }, (_, index) =>
      check(`unrelated-${index}`, "success", earlier),
    ),
    2: [
      check("validate", "success", later),
      check("e2e", "success", later),
      check("CodeQL", "success", later),
    ],
  };
  const tempDir = await mkdtemp(join(tmpdir(), "monikey-release-verifier-"));
  const outputFile = join(tempDir, "github-output.txt");
  try {
    const result = await runVerifier({ checkPages, outputFile });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Verified main merge/);
    assert.ok(result.requests.some((request) => request.includes("page=2")));
    assert.match(
      await readFile(outputFile, "utf8"),
      /pull_request=57\npull_request_head=[b]{40}\n/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a failed newest required check even if an older run passed", async () => {
  const checkPages = {
    1: [
      check("validate", "success", "2026-10-23T01:00:00Z"),
      check("validate", "failure", "2026-10-23T02:00:00Z"),
      check("e2e", "success", "2026-10-23T02:00:00Z"),
      check("CodeQL", "success", "2026-10-23T02:00:00Z"),
    ],
  };
  const result = await runVerifier({ checkPages });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /latest validate check .* did not succeed/);
});

test("rejects a source commit that is not the merged main PR commit", async () => {
  const result = await runVerifier({
    pullRequests: [mergedPullRequest("c".repeat(40))],
  });
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /merge commit of exactly one merged PR into main/,
  );
});
