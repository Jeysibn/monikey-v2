const repository = process.env.GITHUB_REPOSITORY;
const sourceSha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF;
const token = process.env.GITHUB_TOKEN;
const apiBase = (
  process.env.GITHUB_API_URL ?? "https://api.github.com"
).replace(/\/$/, "");

function fail(message) {
  console.error(`Release verification failed: ${message}`);
  process.exitCode = 1;
}

async function request(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} returned ${response.status}`);
  }
  return response.json();
}

async function requestAll(path, key) {
  const values = [];
  let page = 1;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await request(
      `${path}${separator}per_page=100&page=${page}`,
    );
    const items = Array.isArray(result) ? result : result[key];
    if (!Array.isArray(items)) {
      throw new Error(`GitHub API ${path} did not return a ${key} array`);
    }
    values.push(...items);
    if (items.length < 100) return values;
    page += 1;
  }
}

async function main() {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    fail("GITHUB_REPOSITORY must be owner/name");
    return;
  }
  if (!sourceSha || !/^[0-9a-f]{40}$/i.test(sourceSha)) {
    fail("GITHUB_SHA must be a full commit SHA");
    return;
  }
  if (ref !== "refs/heads/main") {
    fail("image publication is allowed only from the main branch");
    return;
  }
  if (!token) {
    fail("GITHUB_TOKEN is required to verify the merged PR and checks");
    return;
  }

  const prefix = `/repos/${repository}/commits/${sourceSha}`;
  const pullRequests = await requestAll(`${prefix}/pulls`, "items");
  const mergedMainPullRequests = pullRequests.filter(
    (pullRequest) =>
      pullRequest.base?.ref === "main" &&
      pullRequest.merged_at &&
      pullRequest.merge_commit_sha?.toLowerCase() === sourceSha.toLowerCase(),
  );
  if (mergedMainPullRequests.length !== 1) {
    fail(
      "main commit must be the merge commit of exactly one merged PR into main",
    );
    return;
  }

  const pullRequest = mergedMainPullRequests[0];
  const headSha = pullRequest.head?.sha;
  if (!headSha) {
    fail(`merged PR #${pullRequest.number} has no head SHA`);
    return;
  }

  const checks = await requestAll(
    `/repos/${repository}/commits/${headSha}/check-runs`,
    "check_runs",
  );
  for (const requiredName of ["validate"]) {
    const matching = checks
      .filter((check) => check.name === requiredName)
      .sort((left, right) => {
        const leftTime = Date.parse(
          left.completed_at ?? left.started_at ?? left.created_at,
        );
        const rightTime = Date.parse(
          right.completed_at ?? right.started_at ?? right.created_at,
        );
        return leftTime - rightTime;
      });
    if (matching.length === 0) {
      fail(`merged PR #${pullRequest.number} has no ${requiredName} check`);
      return;
    }
    const newestTime =
      matching.at(-1).completed_at ??
      matching.at(-1).started_at ??
      matching.at(-1).created_at;
    const newest = matching.filter((check) => {
      const checkTime =
        check.completed_at ?? check.started_at ?? check.created_at;
      return checkTime === newestTime;
    });
    if (
      newest.some(
        (check) =>
          check.status !== "completed" || check.conclusion !== "success",
      )
    ) {
      fail(
        `latest ${requiredName} check on PR head ${headSha} did not succeed`,
      );
      return;
    }
  }

  console.log(
    `Verified main merge ${sourceSha} from PR #${pullRequest.number}; required checks passed on PR head ${headSha}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `pull_request=${pullRequest.number}\npull_request_head=${headSha}\n`,
    );
  }
}

main().catch((error) => {
  fail(
    error instanceof Error ? error.message : "unexpected verification error",
  );
});
