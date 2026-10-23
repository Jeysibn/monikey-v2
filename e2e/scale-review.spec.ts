import { expect, test } from "@playwright/test";
import { apiBaseUrl } from "./origins.js";

test("10,000 transaction pages stay owner-scoped and render incrementally", async ({
  page,
}) => {
  const email = process.env.MONIKEY_SCALE_EMAIL ?? "scale@example.test";
  const password = process.env.MONIKEY_SCALE_PASSWORD;
  test.skip(
    !password,
    "Set the disposable scale user's password to enable this local review.",
  );

  const login = await page.request.post(`${apiBaseUrl}/auth/login`, {
    headers: {
      origin: new URL(
        process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
      ).origin,
    },
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  const { csrfToken } = await login.json();

  const started = performance.now();
  const pageLatencies: number[] = [];
  const ids = new Set<string>();
  let cursor: string | null = null;
  let firstPage: {
    activity: Array<{ transaction: { id: string } }>;
    nextCursor: string | null;
  };
  do {
    const url = new URL("/api/v1/transactions", apiBaseUrl);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const requestStarted = performance.now();
    const response = await page.request.get(url.toString(), {
      headers: { "x-csrf-token": csrfToken },
    });
    pageLatencies.push(performance.now() - requestStarted);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      activity: Array<{ transaction: { id: string } }>;
      nextCursor: string | null;
    };
    firstPage ??= body;
    for (const item of body.activity) {
      expect(ids.has(item.transaction.id)).toBeFalsy();
      ids.add(item.transaction.id);
    }
    cursor = body.nextCursor;
  } while (cursor);
  const apiElapsed = performance.now() - started;
  expect(ids.size).toBeGreaterThanOrEqual(10000);

  const accountResponse = await page.request.get(`${apiBaseUrl}/accounts`, {
    headers: { "x-csrf-token": csrfToken },
  });
  expect(accountResponse.ok()).toBeTruthy();
  const accounts = (await accountResponse.json()).accounts as Array<{
    name: string;
    balanceMinor: string;
  }>;
  expect(
    accounts.find((account) => account.name === "Local Scale Review")
      ?.balanceMinor,
  ).toBe("-10000");

  await page.goto("/app/activity");
  await expect(page.locator(".activity-feed-row")).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  let injectedDuplicate = false;
  await page.route("**/api/v1/transactions?**cursor=**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      activity: Array<{ transaction: { id: string } }>;
    };
    if (!injectedDuplicate && body.activity.length) {
      body.activity.push(body.activity[0]!);
      injectedDuplicate = true;
    }
    await route.fulfill({ response, json: body });
  });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.locator(".activity-feed-row")).toHaveCount(50);
  expect(injectedDuplicate).toBeTruthy();
  await page.unroute("**/api/v1/transactions?**cursor=**");

  await page.getByLabel("Type").selectOption("EXPENSE");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/kind=EXPENSE/);
  await expect(page.locator(".activity-feed-row")).toHaveCount(25);
  await page.getByLabel("Type").selectOption("INCOME");
  let paginationQuery = "";
  page.on("request", (request) => {
    if (
      request.url().includes("/api/v1/transactions?") &&
      request.url().includes("cursor=")
    )
      paginationQuery = request.url();
  });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect.poll(() => paginationQuery).toContain("kind=EXPENSE");
  const rowHrefs = await page
    .locator(".activity-feed-row")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLAnchorElement).getAttribute("href")),
    );
  expect(new Set(rowHrefs).size).toBe(rowHrefs.length);

  await page.getByLabel("Type").selectOption("EXPENSE");
  await page.getByLabel("From").fill("2026-10-10");
  let failFilteredRequest = true;
  await page.route("**/api/v1/transactions?**kind=EXPENSE**", async (route) => {
    if (failFilteredRequest) {
      failFilteredRequest = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("alert")).toContainText("Activity unavailable");
  await expect(page.locator(".activity-feed-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".activity-feed-row")).toHaveCount(25);

  const secondaryLogin = await page.request.post(`${apiBaseUrl}/auth/login`, {
    headers: {
      origin: new URL(
        process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
      ).origin,
    },
    data: {
      email: "scale-secondary@example.test",
      password: "CI-only-scale-secondary-password-never-used",
    },
  });
  expect(secondaryLogin.ok()).toBeTruthy();
  const secondaryActivity = await page.request.get(
    `${apiBaseUrl}/transactions?limit=100`,
  );
  expect(secondaryActivity.ok()).toBeTruthy();
  await expect(secondaryActivity.json()).resolves.toMatchObject({
    activity: [],
    nextCursor: null,
  });
  const secondaryAccounts = await page.request.get(`${apiBaseUrl}/accounts`);
  expect(secondaryAccounts.ok()).toBeTruthy();
  const foreignAccounts = (await secondaryAccounts.json()).accounts as Array<{
    name: string;
  }>;
  expect(
    foreignAccounts.some((account) => account.name === "Local Scale Review"),
  ).toBe(false);

  const sorted = [...pageLatencies].sort((a, b) => a - b);
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ??
    0;
  console.log(
    `10k list review: ${ids.size} unique entries, ${pageLatencies.length} API pages, ${apiElapsed.toFixed(0)} ms total, p95 ${p95.toFixed(0)} ms, UI first 50 rendered`,
  );
  expect(firstPage!.activity).toHaveLength(100);
});
