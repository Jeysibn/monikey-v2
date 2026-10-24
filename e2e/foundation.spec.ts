import { expect, test, type APIResponse } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { apiBaseUrl, apiUrl, webOrigin } from "./origins.js";

test("renders the honest home preview without sample finances", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(
    page.getByRole("heading", {
      name: "Your money, in balance.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").getByText(/Foundation preview/),
  ).toBeVisible();
  await expect(
    page.getByText("Ready for the first real account"),
  ).toBeVisible();
  await expect(page.getByText(/₱\s?[\d,]+\.\d{2}/)).toHaveCount(0);
});

test("routes, deep links and browser history preserve the requested screen", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/app\/activity$/);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Your money, in balance." }),
  ).toBeVisible();

  await page.goto("/app/accounts/card-1/statements");
  await expect(page.getByRole("heading", { name: "Statements" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Statements" })).toBeVisible();
});

test("quick add action and theme control have accessible route states", async ({
  page,
}) => {
  await page.goto("/app");
  const quickAddTrigger = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Add transaction" });
  await quickAddTrigger.click();
  await expect(page).toHaveURL(/\/app\/transactions\/new$/);
  await expect(
    page.getByRole("heading", { name: "A clear entry, without extra steps." }),
  ).toBeVisible();
  await expect(
    page.getByText("Preview only. Nothing is saved from this screen yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record expense" }),
  ).toBeDisabled();
  const previewSelects = page.locator(".quick-add-card select");
  await expect(previewSelects.nth(0)).toBeDisabled();
  await expect(previewSelects.nth(1)).toBeDisabled();

  const amount = page.getByLabel("Amount");
  await amount.fill("1.234");
  await page.getByRole("heading", { name: "New transaction" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter PHP with up to two decimal places.",
  );
  await amount.fill("1,250.50");
  await page.getByRole("heading", { name: "New transaction" }).click();
  await expect(page.locator(".field-valid-mark")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#0b1220",
  );
});

test("unknown browser routes show an in-shell recovery page", async ({
  page,
}) => {
  await page.goto("/not-a-monikey-page");
  await expect(
    page.getByRole("heading", { name: "That page is not here." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Home" }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("secondary pages are reachable from the mobile more menu", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "mobile-chromium");
  await page.goto("/app");
  const contentBounds = await page.locator(".page-content").boundingBox();
  const navigationBounds = await page.locator(".mobile-nav").boundingBox();
  expect(contentBounds).not.toBeNull();
  expect(navigationBounds).not.toBeNull();
  expect(navigationBounds!.y).toBeGreaterThanOrEqual(
    contentBounds!.y + contentBounds!.height - 1,
  );
  await page.locator(".mobile-more-menu summary").click();
  await page
    .getByRole("navigation", { name: "More pages" })
    .getByRole("link", { name: "Bills" })
    .click();
  await expect(page).toHaveURL(/\/app\/bills$/);
  await expect(page.getByRole("heading", { name: "Bills" })).toBeVisible();
});

test("privacy masking toggles without exposing a sample balance", async ({
  page,
}) => {
  await page.goto("/app/settings");
  await expect(
    page.getByText("Text sample only. No account balance is displayed here."),
  ).toBeVisible();
  await expect(page.getByText("Private value", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide preview text" }).click();
  await expect(page.getByText("••••••")).toBeVisible();
  await page.getByRole("button", { name: "Reveal preview text" }).click();
  await expect(page.getByText("Private value", { exact: true })).toBeVisible();
  await expect(page.getByText(/₱\s?[\d,]+\.\d{2}/)).toHaveCount(0);
});

test("browser reaches the live API backed by PostgreSQL", async ({ page }) => {
  await page.goto("/");
  const liveResponse = await page.request.get("/api/v1/health/live");
  expect(liveResponse.status()).toBe(200);
  await expect(liveResponse.json()).resolves.toEqual({ status: "ok" });
  const response = await page.request.get("/api/v1/health/ready");
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    database: "connected",
  });
  const metricsResponse = await page.request.get(
    new URL("/metrics", apiBaseUrl).toString(),
  );
  expect(metricsResponse.status()).toBe(200);
  expect(metricsResponse.headers()["content-type"]).toContain("text/plain");
  expect(metricsResponse.headers()["cache-control"]).toBe("no-store");
  const metrics = await metricsResponse.text();
  expect(metrics).toContain("monikey_database_connected 1");
  expect(metrics).toContain("monikey_ledger_invariant_failures_total 0");
  expect(metrics).toContain('route="/api/v1/health/ready"');
  expect(metrics).not.toContain("second@example.test");
  expect(metrics).not.toContain("personal-id-");
  expect(metrics).not.toContain("amountMinor");
});

test("publishes a shell-only PWA manifest and reports offline state", async ({
  page,
}) => {
  await page.goto("/app");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  await expect(manifest.json()).resolves.toMatchObject({
    name: "MoniKey V2",
    start_url: "/app",
    display: "standalone",
    icons: expect.arrayContaining([
      expect.objectContaining({
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      }),
      expect.objectContaining({
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      }),
      expect.objectContaining({ src: "/icon.svg", type: "image/svg+xml" }),
    ]),
  });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icon-180.png",
  );
  for (const [src, size] of [
    ["/icon-180.png", 180],
    ["/icon-192.png", 192],
    ["/icon-512.png", 512],
  ] as const) {
    const icon = await page.request.get(src);
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/png");
    const image = await icon.body();
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(image.readUInt32BE(16)).toBe(size);
    expect(image.readUInt32BE(20)).toBe(size);
  }
  const workerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    const cachedUrls = (
      await Promise.all(
        cacheNames.map(async (cacheName) =>
          (await caches.open(cacheName)).keys(),
        ),
      )
    ).flat();
    return {
      scriptUrl: registration.active?.scriptURL ?? "",
      cachedUrls: cachedUrls.map((request) => request.url),
    };
  });
  expect(workerState.scriptUrl).toMatch(/\/sw\.js$/);
  expect(workerState.cachedUrls.some((url) => url.includes("/api/"))).toBe(
    false,
  );

  await page.context().setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your money, in balance." }),
  ).toBeVisible();
  const offlineApiFetch = await page.evaluate(async () => {
    try {
      await fetch("/api/v1/health/ready", { cache: "force-cache" });
      return "resolved";
    } catch {
      return "rejected";
    }
  });
  expect(offlineApiFetch).toBe("rejected");
  const cachedApiUrls = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cachedRequests = (
      await Promise.all(
        cacheNames.map(async (cacheName) =>
          (await caches.open(cacheName)).keys(),
        ),
      )
    ).flat();
    return cachedRequests
      .map((request) => request.url)
      .filter((url) => new URL(url).pathname.startsWith("/api/"));
  });
  expect(cachedApiUrls).toEqual([]);

  await page.context().setOffline(false);
  await page.context().setOffline(true);
  await expect(
    page.getByRole("alert").filter({ hasText: "Offline." }),
  ).toBeVisible();
  await page.context().setOffline(false);
  await expect(
    page.getByRole("alert").filter({ hasText: "Offline." }),
  ).toHaveCount(0);
});

test("unknown API routes use the shared not-found error contract", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.get("/api/v1/does-not-exist");
  expect(response.status()).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      requestId: expect.any(String),
    },
  });
});

test("private login, session recovery, CSRF protection, and logout work", async ({
  browser,
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const loginUrl = apiUrl("/auth/login");
  const rejectedOrigin = await page.request.post(loginUrl, {
    headers: { origin: "https://attacker.example" },
    data: {
      email: "origin-check@example.test",
      password: "CI-only-password-never-used-outside-tests",
    },
  });
  expect(rejectedOrigin.status()).toBe(403);

  const rejectedPassword = await page.request.post(loginUrl, {
    headers: { origin },
    data: { email: "unknown-owner@example.test", password: "wrong-password" },
  });
  expect(rejectedPassword.status()).toBe(401);
  expect(rejectedPassword.headers()["cache-control"]).toBe("private, no-store");
  await expect(rejectedPassword.json()).resolves.toMatchObject({
    error: {
      code: "UNAUTHENTICATED",
      message: "Email or password is incorrect.",
    },
  });

  const login = await page.request.post(loginUrl, {
    headers: { origin },
    data: {
      email: "OWNER@example.test",
      password: "CI-only-password-never-used-outside-tests",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  expect(csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  const sessionCookie = login.headers()["set-cookie"];
  expect(sessionCookie).toContain("__Host-mk_session=");
  expect(sessionCookie).toContain("HttpOnly");
  expect(sessionCookie).toContain("Secure");

  const csrfRecovery = await page.request.get(apiUrl("/auth/csrf"));
  expect(csrfRecovery.status()).toBe(200);
  expect(csrfRecovery.headers()["cache-control"]).toBe("private, no-store");
  await expect(csrfRecovery.json()).resolves.toEqual({ csrfToken });

  const profile = await page.request.get(apiUrl("/me"));
  expect(profile.status()).toBe(200);
  expect(profile.headers()["cache-control"]).toBe("private, no-store");
  const profileData = await profile.json();
  expect(profileData.serverToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(["NEEDS_FIRST_ACCOUNT", "READY"]).toContain(
    profileData.onboardingStatus,
  );
  expect(profileData).toMatchObject({
    user: {
      emailNormalized: "owner@example.test",
      timezone: "Asia/Manila",
      currency: "PHP",
    },
  });

  const firstAccountInput = {
    type: "CASH",
    name: "Onboarding Cash",
    openingBalanceMinor: "12345",
  };
  const firstAccountHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": "onboarding-first-account-test-0001",
  };
  if (profileData.onboardingStatus === "NEEDS_FIRST_ACCOUNT") {
    const firstAccount = await page.request.post(
      apiUrl("/onboarding/first-account"),
      { headers: firstAccountHeaders, data: firstAccountInput },
    );
    expect(firstAccount.status()).toBe(201);
    await expect(firstAccount.json()).resolves.toMatchObject({
      account: {
        type: "CASH",
        name: "Onboarding Cash",
        balanceMinor: "12345",
        currency: "PHP",
      },
    });
    const replayFirstAccount = await page.request.post(
      apiUrl("/onboarding/first-account"),
      { headers: firstAccountHeaders, data: firstAccountInput },
    );
    expect(replayFirstAccount.status()).toBe(201);
  } else {
    const existingAccounts = await page.request
      .get(apiUrl("/accounts"))
      .then((response) => response.json());
    expect(existingAccounts.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Onboarding Cash",
          balanceMinor: "12345",
        }),
      ]),
    );
  }
  const conflictingFirstAccount = await page.request.post(
    apiUrl("/onboarding/first-account"),
    {
      headers: {
        ...firstAccountHeaders,
        "idempotency-key": "onboarding-first-account-conflict-0001",
      },
      data: { ...firstAccountInput, name: "Another first account" },
    },
  );
  expect(conflictingFirstAccount.status()).toBe(409);
  await expect(
    page.request.get(apiUrl("/me")).then((response) => response.json()),
  ).resolves.toMatchObject({ onboardingStatus: "READY" });

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", {
      name: "Your first account is already set up.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your account balances and history are in Accounts. Add another account there whenever you need one.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Account balances and history come from your saved journal. Manage your accounts whenever you need to.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("banner").getByText("Accounts")).toBeVisible();
  await page.getByRole("link", { name: "Go to Accounts" }).click();
  await expect(page).toHaveURL(/\/app\/accounts$/);
  await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();

  await page.goto("/app/transactions/new");
  await expect(
    page.getByRole("heading", { name: "Record it while it is fresh." }),
  ).toBeVisible();
  await page.locator("#quick-add-amount").fill("25.00");
  const quickAddSelects = page.locator(".quick-add-card select");
  const onboardingAccountId = await quickAddSelects
    .nth(0)
    .locator("option")
    .filter({ hasText: "Onboarding Cash" })
    .getAttribute("value");
  expect(onboardingAccountId).toBeTruthy();
  await quickAddSelects.nth(0).selectOption(onboardingAccountId!);
  await quickAddSelects.nth(1).selectOption({ label: "Food" });
  await page.context().setOffline(true);
  await expect(
    page.getByRole("alert").filter({ hasText: "Offline." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record expense" }),
  ).toBeDisabled();
  await page.context().setOffline(false);
  await expect(
    page.getByRole("alert").filter({ hasText: "Offline." }),
  ).toHaveCount(0);

  let firstIdempotencyKey: string | undefined;
  let retryIdempotencyKey: string | undefined;
  let committedTransactionId: string | undefined;
  let injectedResponseLoss = false;
  await page.route("**/api/v1/transactions", async (route) => {
    const response = await route.fetch();
    const idempotencyKey = route.request().headers()["idempotency-key"];
    if (!injectedResponseLoss) {
      injectedResponseLoss = true;
      firstIdempotencyKey = idempotencyKey;
      expect(response.status()).toBe(201);
      committedTransactionId = (await response.json()).transaction.id;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Injected response loss after database commit." },
        }),
      });
      return;
    }

    retryIdempotencyKey = idempotencyKey;
    expect((await response.json()).transaction.id).toBe(committedTransactionId);
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Injected response loss after database commit.",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Record it while it is fresh." }),
  ).toBeVisible();
  await page.locator("#quick-add-amount").fill("25.00");
  const reloadedQuickAddSelects = page.locator(".quick-add-card select");
  await reloadedQuickAddSelects.nth(0).selectOption(onboardingAccountId!);
  await reloadedQuickAddSelects.nth(1).selectOption({ label: "Food" });
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-success")).toHaveText("Transaction saved.");
  expect(injectedResponseLoss).toBe(true);
  expect(firstIdempotencyKey).toBeTruthy();
  expect(retryIdempotencyKey).toBe(firstIdempotencyKey);
  await page.unroute("**/api/v1/transactions");
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Your money, in balance." }),
  ).toBeVisible();
  await expect(
    page.getByText("Available money", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Recent activity", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Onboarding Cash", { exact: true }),
  ).toBeVisible();
  await page.goto("/app/activity?kind=EXPENSE");
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByLabel("Type")).toHaveValue("EXPENSE");
  await page.reload();
  await expect(page.getByLabel("Type")).toHaveValue("EXPENSE");
  await expect(page.locator(".activity-feed-row")).toHaveCount(1);
  await page.locator(".activity-feed-row").click();
  await expect(
    page.getByRole("heading", { name: "Review this record." }),
  ).toBeVisible();
  await page.locator("#detail-amount").fill("20.00");
  await page
    .getByLabel("Reason for edit or reversal *")
    .fill("Corrected test receipt");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.locator(".confirmation-panel")).toHaveCount(0);
  await expect(page.locator(".form-success")).toHaveText(
    "Transaction updated and re-posted through the ledger.",
  );
  await page
    .getByLabel("Reason for edit or reversal *")
    .fill("Removed duplicate test entry");
  await page.getByRole("button", { name: "Reverse transaction" }).click();
  await expect(page.locator(".form-success")).toHaveText(
    "Transaction reversed. Its original journal remains immutable.",
  );
  await page.goto("/app/accounts");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(
    page.getByText("Onboarding Cash", { exact: true }),
  ).toBeVisible();
  await page.locator(".account-detail-row").click();
  await expect(
    page.getByRole("heading", { name: "Onboarding Cash" }),
  ).toBeVisible();
  await page.getByLabel("Name *").fill("Onboarding Cash Renamed");
  await page.getByRole("button", { name: "Save account details" }).click();
  await expect(page.locator(".form-success")).toHaveText(
    "Account details saved.",
  );
  await page.getByRole("button", { name: "Archive account" }).click();
  await expect(page.locator(".form-success")).toHaveText(
    "Account archived. Its history remains available.",
  );
  await page.goto("/app/accounts");
  await page.getByLabel("Include archived history").check();
  await expect(
    page.getByText("Onboarding Cash Renamed", { exact: true }),
  ).toBeVisible();
  await page.locator(".account-detail-row").click();
  await expect(page.getByText(/Archived history/)).toBeVisible();
  await page.goto("/app/transactions/new");
  await page.getByRole("tab", { name: "Transfer" }).click();
  await expect(page.getByText("To account *")).toBeVisible();

  const unsupportedCurrency = await page.request.patch(
    apiUrl("/me/preferences"),
    {
      headers: { origin, "x-csrf-token": csrfToken },
      data: { currency: "USD" },
    },
  );
  expect(unsupportedCurrency.status()).toBe(400);
  const updatePreferences = await page.request.patch(
    apiUrl("/me/preferences"),
    {
      headers: { origin, "x-csrf-token": csrfToken },
      data: { theme: "dark", hideBalances: true },
    },
  );
  expect(updatePreferences.status()).toBe(200);
  expect(updatePreferences.headers()["cache-control"]).toBe(
    "private, no-store",
  );
  await expect(updatePreferences.json()).resolves.toMatchObject({
    preferences: {
      timezone: "Asia/Manila",
      currency: "PHP",
      theme: "dark",
      hideBalances: true,
    },
  });
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Reveal available money" }),
  ).toBeVisible();

  await page.clock.install({ time: new Date("2001-01-01T12:00:00.000Z") });
  await page.goto("/");
  const skewedDeviceProfile = await page.evaluate(async () =>
    fetch("/api/v1/me").then((response) => response.json()),
  );
  expect(skewedDeviceProfile.serverToday).toBe(profileData.serverToday);
  await page.clock.install();

  const sessions = await page.request.get(apiUrl("/auth/sessions"));
  const sessionRows = (await sessions.json()).sessions;
  expect(sessionRows).toHaveLength(1);
  expect(sessionRows[0].current).toBe(true);

  const secondContext = await browser.newContext();
  try {
    const secondLogin = await secondContext.request.post(loginUrl, {
      headers: { origin },
      data: {
        email: "owner@example.test",
        password: "CI-only-password-never-used-outside-tests",
      },
    });
    expect(secondLogin.status()).toBe(200);
    const { csrfToken: secondCsrfToken } = await secondLogin.json();
    const bothSessions = await secondContext.request.get(
      apiUrl("/auth/sessions"),
    );
    expect(bothSessions.headers()["cache-control"]).toBe("private, no-store");
    const activeSessions = (await bothSessions.json()).sessions;
    expect(activeSessions).toHaveLength(2);
    const oldSession = activeSessions.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(oldSession).toBeDefined();
    if (!oldSession) throw new Error("The original session was not listed.");

    const thirdContext = await browser.newContext();
    try {
      const secondUserLogin = await thirdContext.request.post(loginUrl, {
        headers: { origin },
        data: {
          email: "second@example.test",
          password: "CI-only-second-user-password-never-used",
        },
      });
      expect(secondUserLogin.status()).toBe(200);
      const { csrfToken: secondUserCsrfToken } = await secondUserLogin.json();
      const secondUserProfile = await thirdContext.request.get(apiUrl("/me"));
      await expect(secondUserProfile.json()).resolves.toMatchObject({
        user: { theme: "system", hideBalances: false },
      });
      const crossUserRevoke = await thirdContext.request.delete(
        `${apiBaseUrl}/auth/sessions/${oldSession.id}`,
        { headers: { origin, "x-csrf-token": secondUserCsrfToken } },
      );
      expect(crossUserRevoke.status()).toBe(404);
      const ownerExport = await page.request.get(apiUrl("/exports/data.json"));
      expect(ownerExport.status()).toBe(200);
      const ownerExportData = await ownerExport.json();
      const ownerAccountId = ownerExportData.accounts[0]?.id;
      expect(ownerAccountId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const ownerTransactionIds = new Set(
        ownerExportData.transactions.map(
          (transaction: { id: string }) => transaction.id,
        ),
      );
      const ownerCsv = await page.request.get(
        apiUrl("/exports/transactions.csv"),
      );
      expect(ownerCsv.status()).toBe(200);
      expect(ownerCsv.headers()["cache-control"]).toBe("private, no-store");
      const ownerCsvText = await ownerCsv.text();
      for (const transactionId of ownerTransactionIds) {
        expect(ownerCsvText).toContain(transactionId);
      }
      const secondExport = await thirdContext.request.get(
        apiUrl("/exports/data.json"),
      );
      expect(secondExport.status()).toBe(200);
      const secondExportData = await secondExport.json();
      expect(secondExportData.accounts).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ownerAccountId }),
        ]),
      );
      expect(
        secondExportData.transactions.some((transaction: { id: string }) =>
          ownerTransactionIds.has(transaction.id),
        ),
      ).toBe(false);
      const secondCsv = await thirdContext.request.get(
        apiUrl("/exports/transactions.csv"),
      );
      expect(secondCsv.headers()["cache-control"]).toBe("private, no-store");
      const secondCsvText = await secondCsv.text();
      for (const transactionId of ownerTransactionIds) {
        expect(secondCsvText).not.toContain(transactionId);
      }
      const guessedAccount = await thirdContext.request.get(
        `${apiBaseUrl}/accounts/${ownerAccountId}`,
      );
      expect(guessedAccount.status()).toBe(404);
      expect((await page.request.get(apiUrl("/me"))).status()).toBe(200);
    } finally {
      await thirdContext.close();
    }

    const revoke = await secondContext.request.delete(
      `${apiBaseUrl}/auth/sessions/${oldSession.id}`,
      { headers: { origin, "x-csrf-token": secondCsrfToken } },
    );
    expect(revoke.status()).toBe(204);
    expect((await page.request.get(apiUrl("/me"))).status()).toBe(401);

    const missingCsrf = await secondContext.request.post(
      apiUrl("/auth/logout"),
      { headers: { origin } },
    );
    expect(missingCsrf.status()).toBe(403);

    const changedPassword = await secondContext.request.post(
      apiUrl("/auth/change-password"),
      {
        headers: { origin, "x-csrf-token": secondCsrfToken },
        data: {
          currentPassword: "CI-only-password-never-used-outside-tests",
          newPassword: "CI-only-rotated-password-never-used",
        },
      },
    );
    expect(changedPassword.status()).toBe(200);
    const { csrfToken: rotatedCsrfToken } = await changedPassword.json();
    expect(rotatedCsrfToken).not.toBe(secondCsrfToken);

    const oldPassword = await secondContext.request.post(loginUrl, {
      headers: { origin },
      data: {
        email: "owner@example.test",
        password: "CI-only-password-never-used-outside-tests",
      },
    });
    expect(oldPassword.status()).toBe(401);
    const newPasswordLogin = await secondContext.request.post(loginUrl, {
      headers: { origin },
      data: {
        email: "owner@example.test",
        password: "CI-only-rotated-password-never-used",
      },
    });
    expect(newPasswordLogin.status()).toBe(200);
    const { csrfToken: finalCsrfToken } = await newPasswordLogin.json();

    const restoredPassword = await secondContext.request.post(
      apiUrl("/auth/change-password"),
      {
        headers: { origin, "x-csrf-token": finalCsrfToken },
        data: {
          currentPassword: "CI-only-rotated-password-never-used",
          newPassword: "CI-only-password-never-used-outside-tests",
        },
      },
    );
    expect(restoredPassword.status()).toBe(200);
    const { csrfToken: restoredCsrfToken } = await restoredPassword.json();

    const logout = await secondContext.request.post(apiUrl("/auth/logout"), {
      headers: { origin, "x-csrf-token": restoredCsrfToken },
    });
    expect(logout.status()).toBe(204);
    expect((await secondContext.request.get(apiUrl("/me"))).status()).toBe(401);
  } finally {
    await secondContext.close();
  }
});

test("financial accounts preserve opening balances, history, and owner scope", async ({
  browser,
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "second@example.test",
      password: "CI-only-second-user-password-never-used",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const invalidAccount = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "account-invalid-fields-test-0001",
    },
    data: {
      type: "BANK",
      name: "Invalid bank",
      openingBalanceMinor: "100",
      creditLimitMinor: "5000",
    },
  });
  expect(invalidAccount.status()).toBe(400);

  const createHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": "account-create-bank-test-0001",
  };
  const bankInput = {
    type: "BANK",
    name: "Daily Bank",
    openingBalanceMinor: "1000000",
  };
  const createBank = await page.request.post(`${api}/accounts`, {
    headers: createHeaders,
    data: bankInput,
  });
  expect(createBank.status()).toBe(201);
  const bank = (await createBank.json()).account;
  expect(bank).toMatchObject({
    type: "BANK",
    name: "Daily Bank",
    balanceMinor: "1000000",
    currency: "PHP",
    archivedAt: null,
  });

  const replayBank = await page.request.post(`${api}/accounts`, {
    headers: createHeaders,
    data: bankInput,
  });
  expect(replayBank.status()).toBe(201);
  expect((await replayBank.json()).account.id).toBe(bank.id);

  const conflictingReplay = await page.request.post(`${api}/accounts`, {
    headers: createHeaders,
    data: { ...bankInput, name: "Different payload" },
  });
  expect(conflictingReplay.status()).toBe(409);

  const card = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "account-create-card-test-0001",
    },
    data: {
      type: "CREDIT_CARD",
      name: "Travel Card",
      openingBalanceMinor: "125000",
      creditLimitMinor: "1000000",
      statementDay: 15,
      dueDay: 2,
    },
  });
  expect(card.status()).toBe(201);
  const cardAccount = (await card.json()).account;
  expect(cardAccount).toMatchObject({
    type: "CREDIT_CARD",
    balanceMinor: "125000",
    creditLimitMinor: "1000000",
    statementDay: 15,
    dueDay: 2,
    sortOrder: 0,
  });

  const categories = await page.request.get(`${api}/categories?kind=EXPENSE`);
  expect(categories.headers()["cache-control"]).toBe("private, no-store");
  const food = (await categories.json()).categories.find(
    (category: { name: string }) => category.name === "Food",
  );
  expect(food?.id).toBeTruthy();
  const reportBeforeCardActivity = await page.request.get(
    `${api}/reports/monthly?month=2026-10`,
  );
  expect(reportBeforeCardActivity.status()).toBe(200);
  const netExpensesBeforeCardActivity = BigInt(
    (await reportBeforeCardActivity.json()).report.netExpensesMinor as string,
  );
  const cardPurchase = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "card-purchase-test-0001",
    },
    data: {
      kind: "EXPENSE",
      sourceAccountId: cardAccount.id,
      categoryId: food.id,
      amountMinor: "80000",
      occurredOn: "2026-10-22",
    },
  });
  expect(cardPurchase.status()).toBe(201);
  const cardPurchaseResult = await cardPurchase.json();
  const cardRefund = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "card-refund-test-0001",
    },
    data: {
      kind: "REFUND",
      sourceAccountId: cardAccount.id,
      refundedTransactionId: cardPurchaseResult.transaction.id,
      amountMinor: "30000",
      occurredOn: "2026-10-22",
    },
  });
  expect(cardRefund.status()).toBe(201);
  await expect(cardRefund.json()).resolves.toMatchObject({
    transaction: {
      kind: "REFUND",
      refundedTransactionId: cardPurchaseResult.transaction.id,
    },
    account: { id: cardAccount.id, balanceMinor: "175000" },
  });
  const reportAfterCardRefund = await page.request.get(
    `${api}/reports/monthly?month=2026-10`,
  );
  expect(reportAfterCardRefund.status()).toBe(200);
  expect((await reportAfterCardRefund.json()).report.netExpensesMinor).toBe(
    (netExpensesBeforeCardActivity + 50000n).toString(),
  );
  const statement = await page.request.post(
    `${api}/credit-cards/${cardAccount.id}/statements`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": "card-statement-test-0001",
      },
      data: {
        statementDate: "2026-10-20",
        periodStart: "2026-09-20",
        periodEnd: "2026-10-19",
        amountDueMinor: "100000",
        paymentDueDate: "2026-11-02",
        note: "October statement",
      },
    },
  );
  expect(statement.status()).toBe(201);
  const statementRecord = (await statement.json()).statement;
  const cardPayment = await page.request.post(
    `${api}/credit-cards/${cardAccount.id}/payments`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": "card-payment-test-0001",
      },
      data: {
        fundingAccountId: bank.id,
        statementId: statementRecord.id,
        amountMinor: "30000",
        occurredOn: "2026-10-22",
      },
    },
  );
  expect(cardPayment.status()).toBe(201);
  const cardPaymentResult = await cardPayment.json();
  expect(cardPaymentResult).toMatchObject({
    transaction: { kind: "CARD_PAYMENT" },
    cardAccount: { balanceMinor: "145000" },
    fundingAccount: { balanceMinor: "970000" },
  });
  const statements = await page.request.get(
    `${api}/credit-cards/${cardAccount.id}/statements`,
  );
  expect(statements.status()).toBe(200);
  expect(statements.headers()["cache-control"]).toBe("private, no-store");
  await expect(statements.json()).resolves.toMatchObject({
    statements: [
      {
        id: statementRecord.id,
        allocatedMinor: "30000",
        remainingDueMinor: "70000",
      },
    ],
  });
  const concurrentStatementPayments = await Promise.all(
    ["0001", "0002"].map((suffix) =>
      page.request.post(`${api}/credit-cards/${cardAccount.id}/payments`, {
        headers: {
          origin,
          "x-csrf-token": csrfToken,
          "idempotency-key": `card-payment-concurrent-${suffix}`,
        },
        data: {
          fundingAccountId: bank.id,
          statementId: statementRecord.id,
          amountMinor: "40000",
          occurredOn: "2026-10-22",
        },
      }),
    ),
  );
  expect(
    concurrentStatementPayments
      .map((response) => response.status())
      .sort((left, right) => left - right),
  ).toEqual([201, 409]);
  const acceptedStatementPayment = concurrentStatementPayments.find(
    (response) => response.status() === 201,
  );
  expect(acceptedStatementPayment).toBeDefined();
  const acceptedStatementPaymentResult = await acceptedStatementPayment!.json();
  expect(acceptedStatementPaymentResult).toMatchObject({
    transaction: { kind: "CARD_PAYMENT" },
    cardAccount: { balanceMinor: "105000" },
    fundingAccount: { balanceMinor: "930000" },
  });
  const statementsAfterRace = await page.request.get(
    `${api}/credit-cards/${cardAccount.id}/statements`,
  );
  expect(statementsAfterRace.status()).toBe(200);
  await expect(statementsAfterRace.json()).resolves.toMatchObject({
    statements: [
      {
        id: statementRecord.id,
        allocatedMinor: "70000",
        remainingDueMinor: "30000",
      },
    ],
  });
  const correctedStatement = await page.request.patch(
    `${api}/credit-cards/${cardAccount.id}/statements/${statementRecord.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": "card-statement-correction-test-0001",
      },
      data: { amountDueMinor: "120000" },
    },
  );
  expect(correctedStatement.status()).toBe(200);
  await expect(correctedStatement.json()).resolves.toMatchObject({
    statement: { amountDueMinor: "120000", remainingDueMinor: "50000" },
  });
  const dashboard = await page.request.get(`${api}/dashboard/summary`);
  expect(dashboard.status()).toBe(200);
  expect(dashboard.headers()["cache-control"]).toBe("private, no-store");

  const bill = await page.request.post(`${api}/bills`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "bill-create-financial-test-0001",
    },
    data: {
      name: "Month end food",
      categoryId: food.id,
      suggestedAccountId: bank.id,
      amountMode: "FIXED",
      defaultAmountMinor: "10000",
      dueDay: 31,
      startOn: "2026-01-01",
    },
  });
  expect(bill.status()).toBe(201);
  const billRecord = (await bill.json()).bill;
  const billOccurrences = await page.request.get(
    `${api}/bills/occurrences?from=2026-02-01&to=2026-02-28`,
  );
  expect(billOccurrences.status()).toBe(200);
  const febOccurrence = (await billOccurrences.json()).occurrences[0];
  expect(febOccurrence).toMatchObject({
    billId: billRecord.id,
    dueOn: "2026-02-28",
    expectedAmountMinor: "10000",
    status: "OVERDUE",
  });
  const billPaymentRequest = {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "bill-pay-financial-test-0001",
    },
    data: { fundingAccountId: bank.id },
  };
  const simultaneousBillPayments = await Promise.all([
    page.request.post(
      `${api}/bills/occurrences/${febOccurrence.id}/pay`,
      billPaymentRequest,
    ),
    page.request.post(
      `${api}/bills/occurrences/${febOccurrence.id}/pay`,
      billPaymentRequest,
    ),
  ]);
  expect(simultaneousBillPayments.map((response) => response.status())).toEqual(
    [201, 201],
  );
  const [paidBillResult, paidBillReplayResult] = await Promise.all(
    simultaneousBillPayments.map((response) => response.json()),
  );
  expect(paidBillReplayResult).toEqual(paidBillResult);
  expect(paidBillResult).toMatchObject({
    occurrence: { status: "PAID", actualAmountMinor: "10000" },
    transaction: { kind: "EXPENSE" },
  });
  const billTransactionId = paidBillResult.transaction.id as string;
  expect(paidBillReplayResult.transaction.id).toBe(billTransactionId);

  const duplicatePaidBill = await page.request.post(
    `${api}/bills/occurrences/${febOccurrence.id}/pay`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": "bill-pay-already-paid-test-0001",
      },
      data: { fundingAccountId: bank.id },
    },
  );
  expect(duplicatePaidBill.status()).toBe(409);
  const bankAfterBillRetries = await page.request.get(
    `${api}/accounts/${bank.id}`,
  );
  expect(bankAfterBillRetries.status()).toBe(200);
  await expect(bankAfterBillRetries.json()).resolves.toMatchObject({
    account: { balanceMinor: "920000" },
  });

  const ownerContext = await browser.newContext();
  try {
    const ownerLogin = await ownerContext.request.post(`${api}/auth/login`, {
      headers: { origin },
      data: {
        email: "owner@example.test",
        password: "CI-only-password-never-used-outside-tests",
      },
    });
    expect(ownerLogin.status()).toBe(200);
    const ownerCsrfToken = (await ownerLogin.json()).csrfToken as string;
    const ownerReportBefore = await ownerContext.request.get(
      `${api}/reports/monthly?month=2026-10`,
    );
    expect(ownerReportBefore.status()).toBe(200);
    const ownerReportBaseline = (await ownerReportBefore.json()).report;
    const ownerAccounts = await ownerContext.request.get(`${api}/accounts`);
    expect(ownerAccounts.status()).toBe(200);
    expect(
      (await ownerAccounts.json()).accounts.some(
        (account: { id: string }) => account.id === bank.id,
      ),
    ).toBe(false);
    const foreignAccount = await ownerContext.request.get(
      `${api}/accounts/${bank.id}`,
    );
    expect(foreignAccount.status()).toBe(404);
    const foreignAccountActivity = await ownerContext.request.get(
      `${api}/accounts/${bank.id}/activity`,
    );
    expect(foreignAccountActivity.status()).toBe(200);
    await expect(foreignAccountActivity.json()).resolves.toMatchObject({
      activity: [],
      nextCursor: null,
    });
    const foreignAccountRename = await ownerContext.request.patch(
      `${api}/accounts/${bank.id}`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-account-rename-test-0001",
        },
        data: { name: "Foreign account" },
      },
    );
    expect(foreignAccountRename.status()).toBe(404);
    const foreignAccountArchive = await ownerContext.request.post(
      `${api}/accounts/${bank.id}/archive`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-account-archive-test-0001",
        },
      },
    );
    expect(foreignAccountArchive.status()).toBe(404);
    const foreignCardPayment = await ownerContext.request.post(
      `${api}/credit-cards/${cardAccount.id}/payments`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-card-payment-test-0001",
        },
        data: {
          fundingAccountId: bank.id,
          amountMinor: "1000",
          occurredOn: "2026-10-22",
        },
      },
    );
    expect(foreignCardPayment.status()).toBe(404);
    const foreignStatements = await ownerContext.request.get(
      `${api}/credit-cards/${cardAccount.id}/statements`,
    );
    expect(foreignStatements.status()).toBe(404);
    const foreignStatementCreate = await ownerContext.request.post(
      `${api}/credit-cards/${cardAccount.id}/statements`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-card-statement-create-test-0001",
        },
        data: {
          statementDate: "2026-10-20",
          periodStart: "2026-09-20",
          periodEnd: "2026-10-19",
          amountDueMinor: "1000",
          paymentDueDate: "2026-11-02",
        },
      },
    );
    expect(foreignStatementCreate.status()).toBe(404);
    const foreignStatementCorrection = await ownerContext.request.patch(
      `${api}/credit-cards/${cardAccount.id}/statements/${statementRecord.id}`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-card-statement-correction-test-0001",
        },
        data: { amountDueMinor: "100000" },
      },
    );
    expect(foreignStatementCorrection.status()).toBe(404);
    const ownerBills = await ownerContext.request.get(`${api}/bills`);
    expect(ownerBills.status()).toBe(200);
    expect(
      (await ownerBills.json()).bills.some(
        (row: { id: string }) => row.id === billRecord.id,
      ),
    ).toBe(false);
    const foreignBillUpdate = await ownerContext.request.patch(
      `${api}/bills/${billRecord.id}`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-bill-update-test-0001",
        },
        data: { name: "Foreign bill" },
      },
    );
    expect(foreignBillUpdate.status()).toBe(404);
    const ownerOccurrences = await ownerContext.request.get(
      `${api}/bills/occurrences?from=2026-02-01&to=2026-02-28`,
    );
    expect(ownerOccurrences.status()).toBe(200);
    expect(
      (await ownerOccurrences.json()).occurrences.some(
        (occurrence: { id: string }) => occurrence.id === febOccurrence.id,
      ),
    ).toBe(false);
    const foreignOccurrenceSkip = await ownerContext.request.post(
      `${api}/bills/occurrences/${febOccurrence.id}/skip`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-bill-occurrence-skip-test-0001",
        },
        data: { reason: "Owner scope check" },
      },
    );
    expect(foreignOccurrenceSkip.status()).toBe(404);
    const foreignOccurrencePay = await ownerContext.request.post(
      `${api}/bills/occurrences/${febOccurrence.id}/pay`,
      {
        headers: {
          origin,
          "x-csrf-token": ownerCsrfToken,
          "idempotency-key": "foreign-bill-occurrence-pay-test-0001",
        },
        data: { fundingAccountId: bank.id },
      },
    );
    expect(foreignOccurrencePay.status()).toBe(404);
    const ownerTransactions = await ownerContext.request.get(
      `${api}/transactions`,
    );
    expect(ownerTransactions.status()).toBe(200);
    const ownerTransactionIds = new Set(
      (await ownerTransactions.json()).activity.map(
        (row: { transaction: { id: string } }) => row.transaction.id,
      ),
    );
    const ownerReport = await ownerContext.request.get(
      `${api}/reports/monthly?month=2026-10`,
    );
    expect(ownerReport.status()).toBe(200);
    await expect(ownerReport.json()).resolves.toMatchObject({
      report: {
        incomeMinor: ownerReportBaseline.incomeMinor,
        netExpensesMinor: ownerReportBaseline.netExpensesMinor,
        netCashFlowMinor: ownerReportBaseline.netCashFlowMinor,
      },
    });
    for (const transactionId of [
      cardPaymentResult.transaction.id as string,
      billTransactionId,
    ]) {
      expect(ownerTransactionIds.has(transactionId)).toBe(false);
      const foreignTransaction = await ownerContext.request.get(
        `${api}/transactions/${transactionId}`,
      );
      expect(foreignTransaction.status()).toBe(404);
      const foreignAudit = await ownerContext.request.get(
        `${api}/transactions/${transactionId}/audit`,
      );
      expect(foreignAudit.status()).toBe(404);
      const foreignTransactionEdit = await ownerContext.request.patch(
        `${api}/transactions/${transactionId}`,
        {
          headers: {
            origin,
            "x-csrf-token": ownerCsrfToken,
            "idempotency-key": `foreign-transaction-edit-${transactionId}`,
          },
          data: {
            kind: "EXPENSE",
            sourceAccountId: bank.id,
            categoryId: food.id,
            amountMinor: "1000",
            occurredOn: "2026-10-22",
            reason: "Owner scope check",
          },
        },
      );
      expect(foreignTransactionEdit.status()).toBe(404);
      const foreignTransactionDelete = await ownerContext.request.delete(
        `${api}/transactions/${transactionId}`,
        {
          headers: {
            origin,
            "x-csrf-token": ownerCsrfToken,
            "idempotency-key": `foreign-transaction-delete-${transactionId}`,
          },
          data: { reason: "Owner scope check" },
        },
      );
      expect(foreignTransactionDelete.status()).toBe(404);
    }
  } finally {
    await ownerContext.close();
  }

  const profile = await page.request.get(`${api}/me`);
  await expect(profile.json()).resolves.toMatchObject({
    onboardingStatus: "READY",
  });

  const rename = await page.request.patch(`${api}/accounts/${bank.id}`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": "account-rename-bank-test-0001",
    },
    data: { name: "Daily Bank Renamed", sortOrder: 20 },
  });
  expect(rename.status()).toBe(200);
  await expect(rename.json()).resolves.toMatchObject({
    account: {
      id: bank.id,
      name: "Daily Bank Renamed",
      balanceMinor: "920000",
      sortOrder: 20,
    },
  });

  const orderedAccounts = await page.request.get(`${api}/accounts`);
  const orderedRows = (await orderedAccounts.json()).accounts;
  expect(orderedRows.map((account: { id: string }) => account.id)).toEqual([
    cardAccount.id,
    bank.id,
  ]);

  const archiveHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": "account-archive-bank-test-0001",
  };
  const archive = await page.request.post(
    `${api}/accounts/${bank.id}/archive`,
    { headers: archiveHeaders },
  );
  expect(archive.status()).toBe(200);
  const archived = (await archive.json()).account;
  expect(archived.archivedAt).toBeTruthy();
  expect(archived.balanceMinor).toBe("920000");

  const archiveReplay = await page.request.post(
    `${api}/accounts/${bank.id}/archive`,
    { headers: archiveHeaders },
  );
  expect((await archiveReplay.json()).account.archivedAt).toBe(
    archived.archivedAt,
  );

  const activeAccounts = await page.request.get(`${api}/accounts`);
  await expect(activeAccounts.json()).resolves.toMatchObject({
    accounts: [{ id: cardAccount.id }],
  });
  const history = await page.request.get(
    `${api}/accounts?includeArchived=true`,
  );
  expect(history.status()).toBe(200);
  const historicalAccounts = (await history.json()).accounts;
  expect(historicalAccounts).toHaveLength(2);
  expect(
    historicalAccounts.find(
      (account: { id: string }) => account.id === bank.id,
    ),
  ).toMatchObject({ archivedAt: archived.archivedAt, balanceMinor: "920000" });

  const missingAccount = await page.request.get(
    `${api}/accounts/941e4567-e89b-42d3-a456-426614174099`,
  );
  expect(missingAccount.status()).toBe(404);
  await expect(missingAccount.json()).resolves.toMatchObject({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
    },
  });
});

test("bill occurrence HTTP validation returns field-level 400 errors", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const login = await page.request.post(apiUrl("/auth/login"), {
    headers: { origin },
    data: {
      email: "bill-window-validation@example.test",
      password: "CI-only-bill-window-validation-password",
    },
  });
  expect(login.status()).toBe(200);

  const cases = [
    {
      query: { from: "2026-02-31", to: "2026-03-01" },
      path: "/from",
      message: "Enter a valid calendar date.",
    },
    {
      query: { from: "2026-03-01", to: "2026-02-28" },
      path: "/from",
      message: "The occurrence window must be ordered.",
    },
    {
      query: { from: "2025-01-01", to: "2026-01-03" },
      path: "/to",
      message: "Occurrence windows cannot be wider than 366 days.",
    },
  ];

  for (const scenario of cases) {
    const query = new URLSearchParams(scenario.query);
    const response = await page.request.get(
      apiUrl(`/bills/occurrences?${query.toString()}`),
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
    });
    expect(body.error.details).toContainEqual({
      path: scenario.path,
      message: scenario.message,
    });
  }

  for (const path of [
    "/transactions?from=2026-02-31&to=2026-03-01",
    "/exports/transactions.csv?from=2026-02-31&to=2026-03-01",
  ]) {
    const response = await page.request.get(apiUrl(path));
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
    });
    expect(body.error.details).toContainEqual({
      path: "/from",
      message: "Enter a valid calendar date.",
    });
  }

  const validLeapDay = await page.request.get(
    apiUrl("/bills/occurrences?from=2024-02-29&to=2024-02-29"),
  );
  expect(validLeapDay.status()).toBe(200);
});

test("bill occurrence generation serializes rule edits on Bills and Dashboard", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const database = new Pool({
    connectionString:
      process.env.PLAYWRIGHT_DATABASE_URL ??
      "postgresql://monikey@localhost:15432/monikey_e2e?schema=public",
  });
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "bill-window-validation@example.test",
      password: "CI-only-bill-window-validation-password",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().replaceAll("-", "");
  const today = (await (await page.request.get(`${api}/me`)).json())
    .serverToday as string;
  const accountResponse = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `occurrence-race-account-${suffix}`,
    },
    data: {
      type: "BANK",
      name: `Occurrence race ${suffix}`,
      openingBalanceMinor: "100000",
    },
  });
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).account.id as string;
  const categories = await page.request.get(`${api}/categories?kind=EXPENSE`);
  const category = (await categories.json()).categories.find(
    (row: { name: string }) => row.name === "Utilities",
  );
  expect(category?.id).toBeTruthy();

  const apiHeaders = (key: string) => ({
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": key,
  });
  const lockPrefix = 73129;
  const lockedBillIds: string[] = [];
  const triggerNames: string[] = [];
  const control = await database.connect();

  async function waitForBlockedQuery(pattern: string, settled: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const waiting = await control.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND datname = current_database()
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND query ILIKE $1
          LIMIT 1`,
        [pattern],
      );
      if (waiting.rowCount) return;
      if (settled()) {
        throw new Error(
          `The expected database lock was not observed: ${pattern}`,
        );
      }
      await delay(20);
    }
    throw new Error(`Timed out waiting for database lock: ${pattern}`);
  }

  async function createRule(name: string) {
    const response = await page.request.post(`${api}/bills`, {
      headers: apiHeaders(`occurrence-race-bill-${suffix}-${name}`),
      data: {
        name: `Occurrence race ${name} ${suffix}`,
        categoryId: category.id,
        suggestedAccountId: accountId,
        amountMode: "FIXED",
        defaultAmountMinor: "1234",
        dueDay: 25,
        startOn: today,
      },
    });
    expect(response.status()).toBe(201);
    const billId = (await response.json()).bill.id as string;
    lockedBillIds.push(billId);
    return billId;
  }

  async function raceRuleEdit(
    name: string,
    readPath: (from: string, to: string) => string,
    readOccurrences: (body: any, billId: string) => string[],
  ) {
    const billId = await createRule(name);
    const lockKey = Number.parseInt(suffix.slice(0, 8), 16) % 2_000_000_000;
    const triggerName = `qa_occurrence_gate_${suffix}_${name}`;
    const functionName = `${triggerName}_fn`;
    triggerNames.push(triggerName, functionName);
    await control.query("SELECT pg_advisory_lock($1, $2)", [
      lockPrefix,
      lockKey,
    ]);
    await control.query(
      `CREATE FUNCTION public.${functionName}() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN
         IF NEW.bill_id = '${billId}'::uuid THEN
           PERFORM pg_advisory_xact_lock(${lockPrefix}, ${lockKey});
         END IF;
         RETURN NEW;
       END $$`,
    );
    await control.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON bill_occurrences
       FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`,
    );

    const fromDate = `${today.slice(0, 7)}-01`;
    const [year, month] = today.slice(0, 7).split("-").map(Number);
    const afterTwoMonths = new Date(Date.UTC(year!, month! + 2, 1));
    const toDate = new Date(afterTwoMonths.getTime() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    let getSettled = false;
    const generationPromise = page.request
      .get(`${api}${readPath(fromDate, toDate)}`)
      .finally(() => {
        getSettled = true;
      });
    await waitForBlockedQuery(
      "%INSERT INTO bill_occurrences%",
      () => getSettled,
    );

    let patchSettled = false;
    const patchPromise = page.request
      .patch(`${api}/bills/${billId}`, {
        headers: apiHeaders(`occurrence-race-patch-${suffix}-${name}`),
        data: { dueDay: 27 },
      })
      .finally(() => {
        patchSettled = true;
      });
    await waitForBlockedQuery(
      "%SELECT id FROM bills WHERE user_id = $1 AND id = $2 FOR UPDATE%",
      () => patchSettled,
    );

    try {
      expect(patchSettled).toBe(false);
    } finally {
      await control.query("SELECT pg_advisory_unlock($1, $2)", [
        lockPrefix,
        lockKey,
      ]);
    }

    const [generation, patch] = await Promise.all([
      generationPromise,
      patchPromise,
    ]);
    expect(generation.status()).toBe(200);
    expect(patch.status()).toBe(200);
    expect((await patch.json()).bill.dueDay).toBe(27);
    const firstDates = readOccurrences(await generation.json(), billId);
    expect(firstDates.length).toBeGreaterThan(0);
    expect(firstDates.every((date) => date.endsWith("-25"))).toBe(true);

    const nextGeneration = await page.request.get(
      `${api}${readPath(fromDate, toDate)}`,
    );
    expect(nextGeneration.status()).toBe(200);
    const nextDates = readOccurrences(await nextGeneration.json(), billId);
    expect(nextDates.length).toBe(firstDates.length);
    expect(nextDates.every((date) => date.endsWith("-27"))).toBe(true);
  }

  try {
    await raceRuleEdit(
      "occurrences",
      (from, to) => `/bills/occurrences?from=${from}&to=${to}`,
      (body, billId) =>
        body.occurrences
          .filter(
            (occurrence: { billId: string }) => occurrence.billId === billId,
          )
          .map((occurrence: { dueOn: string }) => occurrence.dueOn),
    );
    await raceRuleEdit(
      "dashboard",
      () => "/dashboard/summary",
      (body, billId) =>
        body.upcomingBills
          .filter((bill: { billId: string }) => bill.billId === billId)
          .map((bill: { dueOn: string }) => bill.dueOn),
    );
  } finally {
    for (const name of triggerNames.filter((item) => !item.endsWith("_fn"))) {
      await control.query(`DROP TRIGGER IF EXISTS ${name} ON bill_occurrences`);
    }
    for (const name of triggerNames.filter((item) => item.endsWith("_fn"))) {
      await control.query(`DROP FUNCTION IF EXISTS public.${name}()`);
    }
    if (lockedBillIds.length) {
      await control.query(
        `DELETE FROM bill_occurrences WHERE bill_id = ANY($1::uuid[])`,
        [lockedBillIds],
      );
      await control.query(`DELETE FROM bills WHERE id = ANY($1::uuid[])`, [
        lockedBillIds,
      ]);
    }
    await control.query("SELECT pg_advisory_unlock_all()");
    control.release();
    await database.end();
  }
});

test("categories seed defaults and retain archived history", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const secondLogin = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "second@example.test",
      password: "CI-only-second-user-password-never-used",
    },
  });
  expect(secondLogin.status()).toBe(200);
  const { csrfToken } = await secondLogin.json();

  const defaultsResponse = await page.request.get(`${api}/categories`);
  const defaults = (await defaultsResponse.json()).categories;
  expect(defaultsResponse.status()).toBe(200);
  expect(defaults.length).toBeGreaterThanOrEqual(13);
  expect(defaults.map((category: { name: string }) => category.name)).toContain(
    "Food",
  );
  expect(defaults.map((category: { name: string }) => category.name)).toContain(
    "Salary",
  );

  const testRun = test.info().retry;
  const customName = `Coffee ${testRun}`;
  const createHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": `category-create-coffee-test-${testRun}`,
  };
  const create = await page.request.post(`${api}/categories`, {
    headers: createHeaders,
    data: {
      kind: "EXPENSE",
      name: customName,
      sortOrder: 50,
      icon: "coffee",
    },
  });
  expect(create.status()).toBe(201);
  const category = (await create.json()).category;
  expect(category).toMatchObject({
    kind: "EXPENSE",
    name: customName,
    sortOrder: 50,
    icon: "coffee",
    archivedAt: null,
  });

  const createReplay = await page.request.post(`${api}/categories`, {
    headers: createHeaders,
    data: {
      kind: "EXPENSE",
      name: customName,
      sortOrder: 50,
      icon: "coffee",
    },
  });
  expect((await createReplay.json()).category.id).toBe(category.id);

  const duplicate = await page.request.post(`${api}/categories`, {
    headers: {
      ...createHeaders,
      "idempotency-key": `category-duplicate-coffee-test-${testRun}`,
    },
    data: { kind: "EXPENSE", name: customName },
  });
  expect(duplicate.status()).toBe(409);

  const archiveHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": `category-archive-coffee-test-${testRun}`,
  };
  const archive = await page.request.patch(`${api}/categories/${category.id}`, {
    headers: archiveHeaders,
    data: {
      name: "Coffee & Snacks",
      sortOrder: 60,
      icon: "cup-soda",
      archived: true,
    },
  });
  expect(archive.status()).toBe(200);
  const archived = (await archive.json()).category;
  expect(archived).toMatchObject({
    id: category.id,
    name: "Coffee & Snacks",
    sortOrder: 60,
    icon: "cup-soda",
  });
  expect(archived.archivedAt).toBeTruthy();

  const activeCategories = await page.request.get(`${api}/categories`);
  expect(
    (await activeCategories.json()).categories.some(
      (row: { id: string }) => row.id === category.id,
    ),
  ).toBe(false);
  const historicalCategories = await page.request.get(
    `${api}/categories?includeArchived=true`,
  );
  expect(
    (await historicalCategories.json()).categories.some(
      (row: { id: string }) => row.id === category.id,
    ),
  ).toBe(true);

  const foreignLogin = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "sheet@example.test",
      password: "CI-only-sheet-password-never-used",
    },
  });
  expect(foreignLogin.status()).toBe(200);
  const foreignCsrf = (await foreignLogin.json()).csrfToken as string;
  const foreignPatch = await page.request.patch(
    `${api}/categories/${category.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": foreignCsrf,
        "idempotency-key": "category-foreign-patch-test-0001",
      },
      data: { name: "Foreign category" },
    },
  );
  expect(foreignPatch.status()).toBe(404);
  const foreignCategories = await page.request.get(`${api}/categories`);
  expect(foreignCategories.status()).toBe(200);
  expect(
    (await foreignCategories.json()).categories.some(
      (row: { name: string }) => row.name === "Coffee & Snacks",
    ),
  ).toBe(false);
});

test("authenticated quick add opens an accessible sheet with discard protection", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const login = await page.request.post(apiUrl("/auth/login"), {
    headers: { origin },
    data: {
      email: "sheet@example.test",
      password: "CI-only-sheet-password-never-used",
    },
  });
  expect(login.status()).toBe(200);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Your money, in balance." }),
  ).toBeVisible();
  const quickAddTrigger = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Add transaction" });
  await quickAddTrigger.click();
  const sheet = page.getByRole("dialog", {
    name: "Record it while it is fresh.",
  });
  await expect(sheet).toBeVisible();
  const closeButton = sheet.getByRole("button", { name: "Close quick add" });
  await expect(closeButton).toBeFocused();
  const sheetFocusable = sheet.locator(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  await page.keyboard.press("Shift+Tab");
  await expect(sheetFocusable.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app$/);
  await expect(quickAddTrigger).toBeFocused();
  await quickAddTrigger.click();
  await expect(sheet).toBeVisible();
  await page
    .locator(".quick-add-overlay")
    .click({ position: { x: 10, y: 10 } });
  await expect(page).toHaveURL(/\/app$/);
  await expect(quickAddTrigger).toBeFocused();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Add transaction" })
    .click();
  await page.locator("#quick-add-amount").fill("12.50");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Discard this unfinished transaction");
    await dialog.accept();
  });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app$/);
  await expect(quickAddTrigger).toBeFocused();
});

test("quick add asks before recording an expense that makes an account negative", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "sheet@example.test",
      password: "CI-only-sheet-password-never-used",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const account = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `negative-ui-account-${randomUUID()}`,
    },
    data: {
      type: "BANK",
      name: `Negative UI account ${randomUUID()}`,
      openingBalanceMinor: "1000",
    },
  });
  expect(account.status()).toBe(201);
  const accountId = (await account.json()).account.id as string;

  await page.goto("/app");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Add transaction" })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Record it while it is fresh.",
  });
  await expect(sheet).toBeVisible();
  await page.locator("#quick-add-amount").fill("15.00");
  await sheet.getByLabel("Account").selectOption(accountId);
  await sheet.getByLabel("Category").selectOption({ label: "Food" });
  await sheet.getByRole("button", { name: "Record expense" }).click();
  await expect(
    sheet
      .getByRole("alert")
      .getByText("This will make the source account negative. Continue?"),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm and record" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Transaction saved.");

  const accountAfter = await page.request.get(`${api}/accounts/${accountId}`);
  expect(accountAfter.status()).toBe(200);
  expect((await accountAfter.json()).account.balanceMinor).toBe("-500");
});

test("Quick Add retains multiple unresolved submissions across intervening entries and refresh", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "quickadd-retry@example.test",
      password: "CI-only-quickadd-retry-password",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const suffix = randomUUID();
  const accountResponse = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `quick-add-multiple-${suffix}`,
    },
    data: {
      type: "BANK",
      name: `Quick Add Retry ${suffix}`,
      openingBalanceMinor: "100000",
    },
  });
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).account.id as string;
  const categoriesResponse = await page.request.get(`${api}/categories`);
  const food = (await categoriesResponse.json()).categories.find(
    (category: { kind: string; name: string }) =>
      category.kind === "EXPENSE" && category.name === "Food",
  );
  expect(food?.id).toBeTruthy();

  let firstKey = "";
  let secondKey = "";
  let retryKey = "";
  let firstTransactionId = "";
  let lostResponse = false;
  let bAttempt = 0;
  let firstBKey = "";
  await page.route("**/api/v1/transactions", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      amountMinor: string;
      note?: string;
    };
    const key = route.request().headers()["idempotency-key"];
    if (requestBody.note === "separate B" && ++bAttempt === 1) {
      firstBKey = key;
      await route.abort("timedout");
      return;
    }
    const response = await route.fetch();
    const result = await response.json();
    if (requestBody.note === "unresolved A" && !lostResponse) {
      lostResponse = true;
      firstKey = key;
      firstTransactionId = result.transaction.id;
      expect(response.status()).toBe(201);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Injected response loss after database commit." },
        }),
      });
      return;
    }
    if (requestBody.note === "separate B") {
      secondKey = key;
      expect(key).toBe(firstBKey);
    }
    if (requestBody.note === "unresolved A") {
      retryKey = key;
      expect(response.status()).toBe(201);
      expect(result.transaction.id).toBe(firstTransactionId);
    }
    await route.fulfill({ response });
  });

  await page.goto("/app/transactions/new");
  await expect(
    page.getByRole("heading", { name: "Record it while it is fresh." }),
  ).toBeVisible();
  const amount = page.locator("#quick-add-amount");
  const account = page.locator(".quick-add-card select").nth(0);
  const category = page.locator(".quick-add-card select").nth(1);
  await amount.fill("10.00");
  await account.selectOption(accountId);
  await category.selectOption({ label: "Food" });
  await page.getByLabel("Note Optional").fill("unresolved A");
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "result could not be confirmed",
  );

  await amount.fill("5.00");
  await page.getByLabel("Note Optional").fill("separate B");
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "result could not be confirmed",
  );
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-success")).toHaveText("Transaction saved.");
  expect(secondKey).toBeTruthy();
  expect(secondKey).not.toBe(firstKey);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Record it while it is fresh." }),
  ).toBeVisible();
  await amount.fill("10.00");
  await page.locator(".quick-add-card select").nth(0).selectOption(accountId);
  await page
    .locator(".quick-add-card select")
    .nth(1)
    .selectOption({ label: "Food" });
  await page.getByLabel("Note Optional").fill("unresolved A");
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-success")).toHaveText("Transaction saved.");
  expect(retryKey).toBe(firstKey);
  await page.unroute("**/api/v1/transactions");

  const accountAfter = await page.request.get(`${api}/accounts/${accountId}`);
  expect(accountAfter.status()).toBe(200);
  expect((await accountAfter.json()).account.balanceMinor).toBe("98500");
});

test("card payment recovers a committed lost response with the same key", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "card-payment-ui@example.test",
      password: "CI-only-card-payment-ui-password",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const suffix = randomUUID();
  const createAccount = async (
    type: "BANK" | "CREDIT_CARD",
    name: string,
    openingBalanceMinor: string,
  ) => {
    const response = await page.request.post(`${api}/accounts`, {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `card-payment-ui-${suffix}-${type}`,
      },
      data: {
        type,
        name: `${name} ${suffix}`,
        openingBalanceMinor,
        ...(type === "CREDIT_CARD" ? { creditLimitMinor: "500000" } : {}),
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).account as { id: string };
  };
  const funding = await createAccount("BANK", "Payment Funding", "500000");
  const card = await createAccount("CREDIT_CARD", "Payment Card", "100000");

  let firstKey = "";
  let retryKey = "";
  let transactionId = "";
  let paymentBody: Record<string, unknown> = {};
  let retryObserved = false;
  let secondPaymentKey = "";
  let secondPaymentTransactionId = "";
  let requestAttempt = 0;
  await page.route(
    `**/api/v1/credit-cards/${card.id}/payments`,
    async (route) => {
      const key = route.request().headers()["idempotency-key"];
      requestAttempt += 1;
      if (requestAttempt === 1) {
        firstKey = key;
        await route.abort("timedout");
        return;
      }
      const response = await route.fetch();
      const result = await response.json();
      expect(response.status()).toBe(201);
      if (requestAttempt === 2) {
        expect(key).toBe(firstKey);
        transactionId = result.transaction.id;
        paymentBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Injected response loss after database commit." },
          }),
        });
        return;
      }
      if (!retryObserved) {
        retryObserved = true;
        retryKey = key;
        expect(result.transaction.id).toBe(transactionId);
      } else {
        secondPaymentKey = key;
        secondPaymentTransactionId = result.transaction.id;
      }
      await route.fulfill({ response });
    },
  );

  await page.goto(`/app/accounts/${card.id}/pay`);
  const amount = page.getByLabel("Payment amount *");
  const fundingSelect = page.getByLabel("Funding account *");
  const date = page.locator(".card-payment-card input[type=date]");
  await amount.fill("50.00");
  await fundingSelect.selectOption(funding.id);
  const selectedDate = await date.inputValue();
  await page.getByRole("button", { name: "Record card payment" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "result could not be confirmed",
  );
  await page.getByRole("button", { name: "Record card payment" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "result could not be confirmed",
  );

  await page.reload();
  await expect(amount).toBeVisible();
  await amount.fill("50.00");
  await fundingSelect.selectOption(funding.id);
  await date.fill(selectedDate);
  await page.getByRole("button", { name: "Record card payment" }).click();
  await expect(page.getByRole("status")).toContainText("Card payment posted.");
  expect(retryKey).toBe(firstKey);

  const repeatedPaymentRequests = await Promise.all(
    [0, 1].map(() =>
      page.request.post(`${api}/credit-cards/${card.id}/payments`, {
        headers: {
          origin,
          "x-csrf-token": csrfToken,
          "idempotency-key": firstKey,
        },
        data: paymentBody,
      }),
    ),
  );
  expect(repeatedPaymentRequests.map((response) => response.status())).toEqual([
    201, 201,
  ]);
  const repeatedResults = await Promise.all(
    repeatedPaymentRequests.map((response) => response.json()),
  );
  expect(repeatedResults.map((result) => result.transaction.id)).toEqual([
    transactionId,
    transactionId,
  ]);

  await amount.fill("10.00");
  await page.getByLabel("Note Optional").fill("Second legitimate payment");
  await page.getByRole("button", { name: "Record card payment" }).click();
  await expect(page.getByRole("status")).toContainText("Card payment posted.");
  expect(secondPaymentKey).toBeTruthy();
  expect(secondPaymentKey).not.toBe(firstKey);
  expect(secondPaymentTransactionId).not.toBe(transactionId);
  await page.unroute(`**/api/v1/credit-cards/${card.id}/payments`);

  const cardAfter = await page.request.get(`${api}/accounts/${card.id}`);
  const fundingAfter = await page.request.get(`${api}/accounts/${funding.id}`);
  expect((await cardAfter.json()).account.balanceMinor).toBe("94000");
  expect((await fundingAfter.json()).account.balanceMinor).toBe("494000");

  const mismatchedReplay = await page.request.post(
    `${api}/credit-cards/${card.id}/payments`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": firstKey,
      },
      data: {
        fundingAccountId: funding.id,
        amountMinor: "5001",
        occurredOn: selectedDate,
      },
    },
  );
  expect(mismatchedReplay.status()).toBe(409);
  expect(
    (await (await page.request.get(`${api}/accounts/${card.id}`)).json())
      .account.balanceMinor,
  ).toBe("94000");
});

test("bill rules support edit, archive, restore, and recover status request errors", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "second@example.test",
      password: "CI-only-second-user-password-never-used",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().slice(0, 8);
  const accountResponse = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `bill-ui-account-${suffix}`,
    },
    data: {
      type: "BANK",
      name: `Bill UI Funding ${suffix}`,
      openingBalanceMinor: "100000",
    },
  });
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).account.id as string;
  const categories = await page.request.get(`${api}/categories?kind=EXPENSE`);
  const category = (await categories.json()).categories.find(
    (row: { name: string }) => row.name === "Utilities",
  );
  expect(category?.id).toBeTruthy();
  await page.goto("/app/bills");
  const billName = `Bill UI ${suffix}`;
  await page.getByLabel("Name *").fill(billName);
  await page.getByLabel("Expense category *").selectOption(category.id);
  await page.getByLabel("Default amount *").fill("12.34");
  await page.getByLabel("Due day *").fill("15");
  await page.getByLabel("Start date *").fill("2026-11-01");
  await page
    .getByLabel("Suggested funding account Optional")
    .selectOption(accountId);
  let billCreateAttempts = 0;
  const billCreateKeys: string[] = [];
  await page.route("**/api/v1/bills", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    billCreateKeys.push(route.request().headers()["idempotency-key"] ?? "");
    billCreateAttempts += 1;
    if (billCreateAttempts === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Injected bill create response loss." },
        }),
      });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Create bill" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Injected bill create response loss.",
  );
  await page.reload();
  await page.goto("/app/bills");
  await page.getByLabel("Name *").fill(billName);
  await page.getByLabel("Expense category *").selectOption(category.id);
  await page.getByLabel("Default amount *").fill("12.34");
  await page.getByLabel("Due day *").fill("15");
  await page.getByLabel("Start date *").fill("2026-11-01");
  await page
    .getByLabel("Suggested funding account Optional")
    .selectOption(accountId);
  await page.getByRole("button", { name: "Create bill" }).click();
  await expect(page.locator(".form-success")).toContainText("Bill created.");
  expect(billCreateKeys[1]).toBe(billCreateKeys[0]);
  await page.unroute("**/api/v1/bills");

  const savedBills = page.locator(
    'section[aria-labelledby="bill-list-heading"] article.bill-row',
  );
  const savedBill = savedBills.filter({ hasText: billName });
  await expect(savedBill).toBeVisible();
  await expect(savedBills.filter({ hasText: billName })).toHaveCount(1);
  await savedBill.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("heading", { name: "Update reminder details" }),
  ).toBeVisible();
  await page.getByLabel("Name *").fill(`${billName} changed`);
  await page.getByLabel("Default amount *").fill("45.67");
  await page.getByLabel("Due day *").fill("20");
  await page.getByRole("button", { name: "Save bill changes" }).click();
  await expect(page.locator(".form-success")).toContainText(
    "Bill rule updated.",
  );
  const editedBill = savedBills.filter({ hasText: `${billName} changed` });
  await expect(editedBill).toContainText("Due day 20");
  await expect(editedBill).toContainText("₱ 45.67");

  let statusAttempts = 0;
  const statusKeys: string[] = [];
  await page.route(`**/api/v1/bills/*`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const body = route.request().postDataJSON() as { status?: string };
    if (body.status !== "PAUSED") return route.continue();
    statusKeys.push(route.request().headers()["idempotency-key"] ?? "");
    statusAttempts += 1;
    if (statusAttempts === 1) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Injected bill status response loss." },
        }),
      });
    }
    return route.continue();
  });
  await editedBill.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Injected bill status response loss.",
  );
  await editedBill.getByRole("button", { name: "Pause" }).click();
  await expect(editedBill).toContainText("paused");
  expect(statusKeys[1]).toBe(statusKeys[0]);
  await page.unroute(`**/api/v1/bills/*`);

  const currentBill = savedBills.filter({ hasText: `${billName} changed` });
  await currentBill.getByRole("button", { name: "Resume" }).click();
  await expect(currentBill).toContainText("active");
  await currentBill.getByRole("button", { name: "Archive" }).click();
  await expect(
    savedBills.filter({ hasText: `${billName} changed` }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived").check();
  const archivedBill = savedBills.filter({ hasText: `${billName} changed` });
  await expect(archivedBill).toContainText("archived");
  await archivedBill.getByRole("button", { name: "Restore" }).click();
  await expect(archivedBill).toContainText("active");
});

test("card payment separately confirms overdraft and card credit", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "card-payment-ui@example.test",
      password: "CI-only-card-payment-ui-password",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().slice(0, 8);
  const create = async (type: "BANK" | "CREDIT_CARD", balance: string) => {
    const response = await page.request.post(`${api}/accounts`, {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `card-credit-ui-${suffix}-${type}`,
      },
      data: {
        type,
        name: `Credit UI ${type} ${suffix}`,
        openingBalanceMinor: balance,
        ...(type === "CREDIT_CARD" ? { creditLimitMinor: "100000" } : {}),
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).account as { id: string };
  };
  const funding = await create("BANK", "1000");
  const card = await create("CREDIT_CARD", "0");
  await page.goto(`/app/accounts/${card.id}/pay`);
  await page.getByLabel("Payment amount *").fill("50.00");
  await page.getByLabel("Funding account *").selectOption(funding.id);
  await page.getByRole("button", { name: "Record card payment" }).click();
  await expect(page.locator(".form-error")).toContainText("funding account");
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 40.00");
  await page.getByLabel("Payment amount *").fill("51.00");
  await expect(page.locator(".confirmation-panel")).toHaveCount(0);
  await page.getByLabel("Payment amount *").fill("50.00");
  await page.getByRole("button", { name: "Record card payment" }).click();
  await expect(page.locator(".form-error")).toContainText("funding account");
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 40.00");
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "projected card credit",
  );
  await expect(page.locator(".confirmation-panel")).toContainText("₱ 50.00");
  await expect(page.locator(".confirmation-panel")).toContainText(
    "overdraft confirmation is retained",
  );
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.getByRole("status")).toContainText("Card payment posted.");
  const balance = await page.request.get(`${api}/accounts/${card.id}`);
  await expect(balance.json()).resolves.toMatchObject({
    account: { balanceMinor: "-5000" },
  });
  const fundingBalance = await page.request.get(
    `${api}/accounts/${funding.id}`,
  );
  await expect(fundingBalance.json()).resolves.toMatchObject({
    account: { balanceMinor: "-4000" },
  });
});

test("account creation recovers a committed opening balance with its original key", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "account-create-retry@example.test",
      password: "CI-only-account-create-retry-password",
    },
  });
  expect(login.status()).toBe(200);
  const suffix = randomUUID().slice(0, 8);
  const name = `Retry opening ${suffix}`;
  const keys: string[] = [];
  let attempts = 0;
  await page.route("**/api/v1/accounts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    attempts += 1;
    if (attempts === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Injected account response loss." },
        }),
      });
    }
    return route.continue();
  });

  await page.goto("/app/accounts");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name *").fill(name);
  await page.getByLabel("Opening balance *").fill("123.45");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Injected account response loss.",
  );
  await page.reload();
  await page.goto("/app/accounts");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name *").fill(name);
  await page.getByLabel("Opening balance *").fill("123.45");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".form-success")).toContainText(
    "ledger-backed opening balance",
  );
  expect(keys[1]).toBe(keys[0]);
  await page.unroute("**/api/v1/accounts");

  const matches = (
    await (await page.request.get(`${api}/accounts`)).json()
  ).accounts.filter((account: { name: string }) => account.name === name);
  expect(matches).toHaveLength(1);
  const accountResponse = await page.request.get(
    `${api}/accounts/${matches[0].id}`,
  );
  await expect(accountResponse.json()).resolves.toMatchObject({
    account: { balanceMinor: "12345" },
  });
  const openingJournalCount = execFileSync(
    "docker",
    [
      "compose",
      "-p",
      process.env.COMPOSE_PROJECT_NAME ?? "monikey-e2e",
      "-f",
      process.env.COMPOSE_FILE ?? "compose.e2e.yaml",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "monikey",
      "-d",
      "monikey_e2e",
      "-Atc",
      `SELECT count(*) FROM journals j JOIN transaction_revisions r USING (user_id, transaction_id) WHERE r.after_json ->> 'kind' = 'OPENING_BALANCE' AND r.after_json ->> 'accountId' = '${matches[0].id}'`,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(openingJournalCount).toBe("1");
});

test("statement creation replays a committed response-loss without duplication", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "statement-create-retry@example.test",
      password: "CI-only-statement-create-retry-password",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().slice(0, 8);
  const accountResponse = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `statement-retry-card-${suffix}`,
    },
    data: {
      type: "CREDIT_CARD",
      name: `Statement retry card ${suffix}`,
      openingBalanceMinor: "10000",
      creditLimitMinor: "100000",
    },
  });
  expect(accountResponse.status()).toBe(201);
  const cardId = (await accountResponse.json()).account.id as string;
  const statementDate = "2026-10-20";
  const paymentDueDate = "2026-11-02";
  const keys: string[] = [];
  let attempts = 0;
  await page.route(
    `**/api/v1/credit-cards/${cardId}/statements`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      attempts += 1;
      if (attempts === 1) {
        const committed = await route.fetch();
        expect(committed.status()).toBe(201);
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Injected statement response loss." },
          }),
        });
      }
      return route.continue();
    },
  );

  await page.goto(`/app/accounts/${cardId}/statements`);
  await page.getByLabel("Statement date *").fill(statementDate);
  await page.getByLabel("Payment due date *").fill(paymentDueDate);
  await page.getByLabel("Amount due *").fill("321.09");
  await page.getByRole("button", { name: "Record statement" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Injected statement response loss.",
  );
  await page.reload();
  await page.goto(`/app/accounts/${cardId}/statements`);
  await page.getByLabel("Statement date *").fill(statementDate);
  await page.getByLabel("Payment due date *").fill(paymentDueDate);
  await page.getByLabel("Amount due *").fill("321.09");
  await page.getByRole("button", { name: "Record statement" }).click();
  await expect(page.locator(".form-success")).toContainText(
    "Statement recorded.",
  );
  expect(keys[1]).toBe(keys[0]);
  await page.unroute(`**/api/v1/credit-cards/${cardId}/statements`);

  const statements = await page.request.get(
    `${api}/credit-cards/${cardId}/statements`,
  );
  await expect(statements.json()).resolves.toMatchObject({
    statements: [
      expect.objectContaining({
        statementDate,
        paymentDueDate,
        amountDueMinor: "32109",
        remainingDueMinor: "32109",
      }),
    ],
  });
  const balance = await page.request.get(`${api}/accounts/${cardId}`);
  await expect(balance.json()).resolves.toMatchObject({
    account: { balanceMinor: "10000" },
  });
});

test("transaction correction and reversal show projected card and asset balances", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "transaction-edit-confirm@example.test",
      password: "CI-only-transaction-edit-confirm-password",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().slice(0, 8);
  const createAccount = async (
    type: "BANK" | "CREDIT_CARD",
    name: string,
    balance: string,
    key: string,
  ) => {
    const response = await page.request.post(`${api}/accounts`, {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `edit-credit-account-${suffix}-${key}`,
      },
      data: {
        type,
        name,
        openingBalanceMinor: balance,
        ...(type === "CREDIT_CARD" ? { creditLimitMinor: "100000" } : {}),
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).account as { id: string; name: string };
  };
  const funding = await createAccount(
    "BANK",
    `Credit funding ${suffix}`,
    "100000",
    "funding",
  );
  const bank = await createAccount(
    "BANK",
    `Correction bank ${suffix}`,
    "100",
    "target",
  );
  const card = await createAccount(
    "CREDIT_CARD",
    `Correction card ${suffix}`,
    "0",
    "card",
  );
  const today = (await (await page.request.get(`${api}/me`)).json())
    .serverToday as string;
  const categories = await page.request.get(`${api}/categories?kind=EXPENSE`);
  const category = (await categories.json()).categories.find(
    (row: { name: string }) => row.name === "Food",
  );
  expect(category?.id).toBeTruthy();
  const payCredit = await page.request.post(
    `${api}/credit-cards/${card.id}/payments`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `edit-credit-overpay-${suffix}`,
      },
      data: {
        fundingAccountId: funding.id,
        amountMinor: "5000",
        occurredOn: today,
        acknowledgeCardCreditBalance: true,
      },
    },
  );
  expect(payCredit.status()).toBe(201);
  const purchase = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `edit-credit-purchase-${suffix}`,
    },
    data: {
      kind: "EXPENSE",
      sourceAccountId: card.id,
      categoryId: category.id,
      amountMinor: "1000",
      occurredOn: today,
    },
  });
  expect(purchase.status()).toBe(201);
  const purchaseId = (await purchase.json()).transaction.id as string;
  const refund = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `edit-credit-refund-${suffix}`,
    },
    data: {
      kind: "REFUND",
      sourceAccountId: card.id,
      refundedTransactionId: purchaseId,
      amountMinor: "1000",
      occurredOn: today,
      acknowledgeCardCreditBalance: true,
    },
  });
  expect(refund.status()).toBe(201);

  await page.goto(`/app/transactions/${purchaseId}`);
  await page.getByLabel("Amount *").fill("50.00");
  await page.getByLabel("Account *").selectOption(bank.id);
  await page
    .getByPlaceholder("Corrected receipt or duplicate entry")
    .fill("Move corrected expense to bank");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.locator(".form-error")).toContainText(
    "projected card credit",
  );
  await expect(page.locator(".confirmation-panel")).toContainText(card.name);
  await expect(page.locator(".confirmation-panel")).toContainText("₱ 60.00");
  await page
    .getByRole("button", { name: "Confirm card credit and save" })
    .click();
  await expect(page.locator(".confirmation-panel")).toContainText(bank.name);
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 49.00");
  await expect(page.locator(".confirmation-panel")).toContainText("₱ 60.00");
  await page
    .getByRole("button", { name: "Confirm both balances and save" })
    .click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(
    (await page.request.get(`${api}/accounts/${bank.id}`)).json(),
  ).resolves.toMatchObject({ account: { balanceMinor: "-4900" } });
  await expect(
    (await page.request.get(`${api}/accounts/${card.id}`)).json(),
  ).resolves.toMatchObject({ account: { balanceMinor: "-6000" } });

  const reversalPurchase = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `edit-credit-reversal-purchase-${suffix}`,
    },
    data: {
      kind: "EXPENSE",
      sourceAccountId: card.id,
      categoryId: category.id,
      amountMinor: "500",
      occurredOn: today,
    },
  });
  expect(reversalPurchase.status()).toBe(201);
  const reversalPurchaseId = (await reversalPurchase.json()).transaction
    .id as string;
  await page.goto(`/app/transactions/${reversalPurchaseId}`);
  await page
    .getByPlaceholder("Corrected receipt or duplicate entry")
    .fill("Reverse card purchase");
  await page.getByRole("button", { name: "Reverse transaction" }).click();
  await expect(page.locator(".field-hint[role=alert]")).toContainText(
    card.name,
  );
  await expect(page.locator(".field-hint[role=alert]")).toContainText(
    "₱ 60.00",
  );
  await page
    .getByRole("button", { name: "Confirm card credit and reverse" })
    .click();
  await expect(page.getByRole("status")).toContainText("Transaction reversed");
});

test("income edits and reversals require exact overdraft confirmation", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "income-edit-confirm@example.test",
      password: "CI-only-income-edit-confirm-password",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().slice(0, 8);
  const today = (await (await page.request.get(`${api}/me`)).json())
    .serverToday as string;
  const createBank = async (name: string, key: string) => {
    const response = await page.request.post(`${api}/accounts`, {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `income-edit-bank-${suffix}-${key}`,
      },
      data: { type: "BANK", name, openingBalanceMinor: "0" },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).account as { id: string; name: string };
  };
  const sameAccount = await createBank(`Income bank ${suffix}`, "same");
  const categories = await page.request.get(`${api}/categories`);
  const categoryRows = (await categories.json()).categories;
  const incomeCategory = categoryRows.find(
    (row: { kind: string; name: string }) =>
      row.kind === "INCOME" && row.name === "Salary",
  );
  const expenseCategory = categoryRows.find(
    (row: { kind: string; name: string }) =>
      row.kind === "EXPENSE" && row.name === "Food",
  );
  expect(incomeCategory?.id).toBeTruthy();
  expect(expenseCategory?.id).toBeTruthy();
  const postTransaction = async (
    kind: "INCOME" | "EXPENSE",
    accountId: string,
    amountMinor: string,
    key: string,
  ) => {
    const response = await page.request.post(`${api}/transactions`, {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `income-edit-tx-${suffix}-${key}`,
      },
      data: {
        kind,
        sourceAccountId: accountId,
        categoryId: kind === "INCOME" ? incomeCategory.id : expenseCategory.id,
        amountMinor,
        occurredOn: today,
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).transaction.id as string;
  };

  const incomeId = await postTransaction(
    "INCOME",
    sameAccount.id,
    "10000",
    "same-income",
  );
  await postTransaction("EXPENSE", sameAccount.id, "9000", "same-spend");
  await page.goto(`/app/transactions/${incomeId}`);
  await page.getByLabel("Amount *").fill("5.00");
  await page
    .getByPlaceholder("Corrected receipt or duplicate entry")
    .fill("Correct income receipt");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.locator(".confirmation-panel")).toContainText(
    sameAccount.name,
  );
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 85.00");
  await page
    .getByRole("button", { name: "Confirm negative balance and save" })
    .click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(
    (await page.request.get(`${api}/accounts/${sameAccount.id}`)).json(),
  ).resolves.toMatchObject({ account: { balanceMinor: "-8500" } });

  await page
    .getByPlaceholder("Corrected receipt or duplicate entry")
    .fill("Reverse corrected income");
  await page.getByRole("button", { name: "Reverse transaction" }).click();
  await expect(page.locator(".field-hint[role=alert]")).toContainText(
    sameAccount.name,
  );
  await expect(page.locator(".field-hint[role=alert]")).toContainText(
    "-₱ 90.00",
  );
  await page
    .getByRole("button", { name: "Confirm negative balance and reverse" })
    .click();
  await expect(page.getByRole("status")).toContainText("Transaction reversed");
  await expect(
    (await page.request.get(`${api}/accounts/${sameAccount.id}`)).json(),
  ).resolves.toMatchObject({ account: { balanceMinor: "-9000" } });

  const oldAccount = await createBank(`Moved income source ${suffix}`, "old");
  const newAccount = await createBank(`Moved income target ${suffix}`, "new");
  const movedIncomeId = await postTransaction(
    "INCOME",
    oldAccount.id,
    "10000",
    "moved-income",
  );
  await postTransaction("EXPENSE", oldAccount.id, "9500", "moved-spend");
  await page.goto(`/app/transactions/${movedIncomeId}`);
  await page.getByLabel("Amount *").fill("5.00");
  await page.getByLabel("Account *").selectOption(newAccount.id);
  await page
    .getByPlaceholder("Corrected receipt or duplicate entry")
    .fill("Move income to corrected account");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.locator(".confirmation-panel")).toContainText(
    oldAccount.name,
  );
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 95.00");
  await page
    .getByRole("button", { name: "Confirm negative balance and save" })
    .click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(
    (await page.request.get(`${api}/accounts/${oldAccount.id}`)).json(),
  ).resolves.toMatchObject({ account: { balanceMinor: "-9500" } });
  await expect(
    (await page.request.get(`${api}/accounts/${newAccount.id}`)).json(),
  ).resolves.toMatchObject({ account: { balanceMinor: "500" } });
});

test("bill payment shows the projected overdraft and requires confirmation", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "overdraft-check@example.test",
      password: "CI-only-overdraft-check-password",
    },
  });
  expect(login.status()).toBe(200);
  const csrfToken = (await login.json()).csrfToken as string;
  const suffix = randomUUID().slice(0, 8);
  const account = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `bill-overdraft-account-${suffix}`,
    },
    data: {
      type: "BANK",
      name: `Bill overdraft ${suffix}`,
      openingBalanceMinor: "100",
    },
  });
  expect(account.status()).toBe(201);
  const accountId = (await account.json()).account.id as string;
  const categories = await page.request.get(`${api}/categories?kind=EXPENSE`);
  const category = (await categories.json()).categories.find(
    (row: { name: string }) => row.name === "Utilities",
  );
  const bill = await page.request.post(`${api}/bills`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `bill-overdraft-rule-${suffix}`,
    },
    data: {
      name: `Bill overdraft ${suffix}`,
      categoryId: category.id,
      amountMode: "VARIABLE",
      dueDay: 15,
      startOn: "2026-10-01",
      suggestedAccountId: accountId,
    },
  });
  expect(bill.status()).toBe(201);
  await page.goto("/app/bills");
  const occurrence = page
    .locator(
      'section[aria-labelledby="occurrence-heading"] article.occurrence-row',
    )
    .filter({ hasText: `Bill overdraft ${suffix}` })
    .filter({ hasText: "2026-10-15" });
  await expect(occurrence).toBeVisible();
  await occurrence.getByRole("button", { name: "Pay" }).click();
  await occurrence.getByRole("combobox").selectOption(accountId);
  await occurrence.getByPlaceholder("Amount").fill("12.34");
  await occurrence.getByRole("button", { name: "Confirm pay" }).click();
  await expect(page.locator(".form-error")).toContainText("negative balance");
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 11.34");
  await occurrence.getByPlaceholder("Amount").fill("15.00");
  await expect(page.locator(".confirmation-panel")).toHaveCount(0);
  await occurrence.getByPlaceholder("Amount").fill("12.34");
  await occurrence.getByRole("button", { name: "Confirm pay" }).click();
  await expect(page.locator(".confirmation-panel")).toContainText("-₱ 11.34");
  await page
    .getByRole("button", { name: "Confirm negative balance and pay" })
    .click();
  await expect(page.getByRole("status")).toContainText("marked paid");
  await expect(occurrence).toContainText("paid");
});

test("Dashboard ignores an older refresh that finishes after newer ledger data", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "dashboard-refresh@example.test",
      password: "CI-only-dashboard-refresh-password",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Balances at a glance")).toBeVisible();

  const suffix = randomUUID();
  const accountResponse = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `dashboard-refresh-${suffix}`,
    },
    data: {
      type: "BANK",
      name: `Dashboard Refresh ${suffix}`,
      openingBalanceMinor: "100000",
    },
  });
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).account.id as string;
  const categoryResponse = await page.request.get(
    `${api}/categories?kind=EXPENSE`,
  );
  const category = (await categoryResponse.json()).categories.find(
    (item: { name: string }) => item.name === "Food",
  );
  const note = `New dashboard record ${suffix}`;

  let releaseOlder!: () => void;
  let olderReady!: () => void;
  const olderRequest = new Promise<void>((resolve) => (olderReady = resolve));
  const release = new Promise<void>((resolve) => (releaseOlder = resolve));
  let requestCount = 0;
  await page.route("**/api/v1/dashboard/summary", async (route) => {
    const response = await route.fetch();
    if (++requestCount === 1) {
      olderReady();
      await release;
    }
    await route.fulfill({ response });
  });
  const refresh = page.locator(".dashboard-heading-actions button").first();
  await refresh.click();
  await olderRequest;

  const expenseResponse = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `dashboard-expense-${suffix}`,
    },
    data: {
      kind: "EXPENSE",
      sourceAccountId: accountId,
      categoryId: category.id,
      amountMinor: "1000",
      occurredOn: "2026-10-24",
      note,
    },
  });
  expect(expenseResponse.status()).toBe(201);

  await refresh.click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  releaseOlder();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page.unroute("**/api/v1/dashboard/summary");
});

test("Accounts marks failed refreshes stale and Retry reloads real balances", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const login = await page.request.post(apiUrl("/auth/login"), {
    headers: { origin: webOrigin },
    data: {
      email: "accounts-stale@example.test",
      password: "CI-only-accounts-stale-password",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const account = await page.request.post(apiUrl("/accounts"), {
    headers: {
      origin: webOrigin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `accounts-stale-refresh-${randomUUID()}`,
    },
    data: {
      type: "BANK",
      name: `Stale refresh ${randomUUID()}`,
      openingBalanceMinor: "20000",
    },
  });
  expect(account.status()).toBe(201);
  await page.goto("/app/accounts");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(
    page.locator(".accounts-list .account-detail-row").first(),
  ).toBeVisible();

  let failedOnce = false;
  await page.route("**/api/v1/accounts*includeArchived=true", async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Injected temporary refresh failure." },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.locator(".dashboard-heading-actions button").first().click();
  await expect(page.getByRole("alert")).toContainText(
    "Account balances may be out of date",
  );
  await expect(page.getByRole("alert")).toContainText("remain visible");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.unroute("**/api/v1/accounts*includeArchived=true");
});

test("Quick Add refreshes the Manila business date when opened and preserves a chosen date", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const login = await page.request.post(apiUrl("/auth/login"), {
    headers: { origin: webOrigin },
    data: {
      email: "manila-date@example.test",
      password: "CI-only-manila-date-password",
    },
  });
  expect(login.status()).toBe(200);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "manila-date@example.test" }),
  ).toBeVisible();

  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const profile = await response.json();
    profile.serverToday = "2030-01-02";
    await route.fulfill({ response, json: profile });
  });
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Add transaction" })
    .click();
  const date = page.locator(".quick-add-card input[type=date]");
  await expect(date).toHaveValue("2030-01-02");
  await date.fill("2030-01-01");
  await page.getByLabel("Amount").fill("5.00");
  await expect(date).toHaveValue("2030-01-01");
  await page.unroute("**/api/v1/me");
});

test("expense and income commands are balanced and retry-safe", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const api = apiBaseUrl;
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "second@example.test",
      password: "CI-only-second-user-password-never-used",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const testRun = test.info().retry;
  const accountKey = `transaction-account-test-${testRun}`;
  const account = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": accountKey,
    },
    data: {
      type: "BANK",
      name: `Transaction Bank ${testRun}`,
      openingBalanceMinor: "100000",
    },
  });
  expect(account.status()).toBe(201);
  const accountRow = (await account.json()).account;
  const categories = await page.request.get(`${api}/categories`);
  expect(categories.status()).toBe(200);
  const categoryRows = (await categories.json()).categories as Array<{
    id: string;
    kind: string;
    name: string;
  }>;
  const expenseCategory = categoryRows.find(
    (category) => category.kind === "EXPENSE" && category.name === "Food",
  );
  const incomeCategory = categoryRows.find(
    (category) => category.kind === "INCOME" && category.name === "Salary",
  );
  expect(expenseCategory).toBeDefined();
  expect(incomeCategory).toBeDefined();
  if (!expenseCategory || !incomeCategory)
    throw new Error("Seed categories missing.");

  const expenseBody = {
    kind: "EXPENSE",
    sourceAccountId: accountRow.id,
    categoryId: expenseCategory.id,
    amountMinor: "25000",
    occurredOn: "2026-10-22",
    note: "Lunch",
  };
  const transactionHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": `transaction-expense-test-${testRun}`,
  };
  const expense = await page.request.post(`${api}/transactions`, {
    headers: transactionHeaders,
    data: expenseBody,
  });
  expect(expense.status()).toBe(201);
  const expenseResult = await expense.json();
  expect(typeof expenseResult.requestId).toBe("string");
  expect(expenseResult.requestId.length).toBeGreaterThan(0);
  expect(expenseResult).toMatchObject({
    transaction: {
      kind: "EXPENSE",
      categoryId: expenseCategory.id,
      note: "Lunch",
    },
    account: { id: accountRow.id, balanceMinor: "75000" },
  });

  const apiContainer = execFileSync("docker", ["compose", "ps", "-q", "api"], {
    encoding: "utf8",
  }).trim();
  expect(apiContainer).not.toBe("");
  execFileSync("docker", ["compose", "restart", "api"], {
    stdio: "pipe",
  });

  let apiReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const readyResponse = await page.request.get(`${api}/health/ready`, {
        timeout: 1_000,
      });
      if (readyResponse.status() === 200) {
        apiReady = true;
        break;
      }
    } catch {
      // The API is expected to refuse connections during its container restart.
    }
    await page.waitForTimeout(500);
  }
  expect(apiReady).toBe(true);

  const concurrentReplays = await Promise.all([
    page.request.post(`${api}/transactions`, {
      headers: transactionHeaders,
      data: expenseBody,
    }),
    page.request.post(`${api}/transactions`, {
      headers: transactionHeaders,
      data: expenseBody,
    }),
  ]);
  expect(concurrentReplays.map((response) => response.status())).toEqual([
    201, 201,
  ]);
  const [replayResult, secondReplayResult] = await Promise.all(
    concurrentReplays.map((response) => response.json()),
  );
  expect(typeof replayResult.requestId).toBe("string");
  expect(replayResult.requestId.length).toBeGreaterThan(0);
  expect(replayResult.requestId).not.toBe(expenseResult.requestId);
  expect(replayResult.transaction.id).toBe(expenseResult.transaction.id);
  expect(secondReplayResult.transaction.id).toBe(expenseResult.transaction.id);
  expect(secondReplayResult.requestId).not.toBe(replayResult.requestId);
  const accountAfterReplay = await page.request.get(
    `${api}/accounts/${accountRow.id}`,
  );
  expect(accountAfterReplay.status()).toBe(200);
  await expect(accountAfterReplay.json()).resolves.toMatchObject({
    account: { balanceMinor: "75000" },
  });

  const conflict = await page.request.post(`${api}/transactions`, {
    headers: transactionHeaders,
    data: { ...expenseBody, amountMinor: "26000" },
  });
  expect(conflict.status()).toBe(409);

  const income = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `transaction-income-test-${testRun}`,
    },
    data: {
      kind: "INCOME",
      sourceAccountId: accountRow.id,
      categoryId: incomeCategory.id,
      amountMinor: "40000",
      occurredOn: "2026-10-22",
    },
  });
  expect(income.status()).toBe(201);
  await expect(income.json()).resolves.toMatchObject({
    transaction: { kind: "INCOME", categoryId: incomeCategory.id },
    account: { id: accountRow.id, balanceMinor: "115000" },
  });

  const destination = await page.request.post(`${api}/accounts`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `transaction-destination-test-${testRun}`,
    },
    data: {
      type: "EWALLET",
      name: `Transaction Destination ${testRun}`,
      openingBalanceMinor: "0",
    },
  });
  expect(destination.status()).toBe(201);
  const destinationRow = (await destination.json()).account;
  const transferBody = {
    kind: "TRANSFER",
    fromAccountId: accountRow.id,
    toAccountId: destinationRow.id,
    amountMinor: "10000",
    feeMinor: "1500",
    feeCategoryId: expenseCategory.id,
    occurredOn: "2026-10-22",
  };
  const transferHeaders = {
    origin,
    "x-csrf-token": csrfToken,
    "idempotency-key": `transaction-transfer-test-${testRun}`,
  };
  const transfer = await page.request.post(`${api}/transactions`, {
    headers: transferHeaders,
    data: transferBody,
  });
  expect(transfer.status()).toBe(201);
  const transferResult = await transfer.json();
  expect(typeof transferResult.requestId).toBe("string");
  expect(transferResult).toMatchObject({
    transaction: {
      kind: "TRANSFER",
      categoryId: null,
    },
    sourceAccount: { id: accountRow.id, balanceMinor: "103500" },
    destinationAccount: { id: destinationRow.id, balanceMinor: "10000" },
  });
  const transferReplay = await page.request.post(`${api}/transactions`, {
    headers: transferHeaders,
    data: transferBody,
  });
  expect(transferReplay.status()).toBe(201);
  const transferReplayResult = await transferReplay.json();
  expect(typeof transferReplayResult.requestId).toBe("string");
  expect(transferReplayResult.requestId).not.toBe(transferResult.requestId);
  expect(transferReplayResult.transaction.id).toBe(
    transferResult.transaction.id,
  );
  const transferConflict = await page.request.post(`${api}/transactions`, {
    headers: transferHeaders,
    data: { ...transferBody, amountMinor: "11000" },
  });
  expect(transferConflict.status()).toBe(409);

  const refundExpense = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `transaction-refund-expense-${testRun}`,
    },
    data: {
      kind: "EXPENSE",
      sourceAccountId: accountRow.id,
      categoryId: expenseCategory.id,
      amountMinor: "5000",
      occurredOn: "2026-10-22",
    },
  });
  expect(refundExpense.status()).toBe(201);
  const refundExpenseResult = await refundExpense.json();
  const refund = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `transaction-refund-test-${testRun}`,
    },
    data: {
      kind: "REFUND",
      sourceAccountId: destinationRow.id,
      refundedTransactionId: refundExpenseResult.transaction.id,
      amountMinor: "1000",
      occurredOn: "2026-10-22",
    },
  });
  expect(refund.status()).toBe(201);
  const refundResult = await refund.json();
  expect(refundResult).toMatchObject({
    transaction: {
      kind: "REFUND",
      categoryId: expenseCategory.id,
      refundedTransactionId: refundExpenseResult.transaction.id,
    },
    account: { id: destinationRow.id, balanceMinor: "11000" },
  });

  const underRefundEdit = await page.request.patch(
    `${api}/transactions/${refundExpenseResult.transaction.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `transaction-edit-under-refund-${testRun}`,
      },
      data: {
        kind: "EXPENSE",
        sourceAccountId: accountRow.id,
        categoryId: expenseCategory.id,
        amountMinor: "500",
        occurredOn: "2026-10-22",
        reason: "Cannot reduce below posted refund",
      },
    },
  );
  expect(underRefundEdit.status()).toBe(409);

  const adjustment = await page.request.post(`${api}/transactions`, {
    headers: {
      origin,
      "x-csrf-token": csrfToken,
      "idempotency-key": `transaction-adjustment-test-${testRun}`,
    },
    data: {
      kind: "ADJUSTMENT",
      accountId: accountRow.id,
      direction: "INCREASE",
      amountMinor: "500",
      occurredOn: "2026-10-22",
    },
  });
  expect(adjustment.status()).toBe(201);
  await expect(adjustment.json()).resolves.toMatchObject({
    transaction: { kind: "ADJUSTMENT", categoryId: null },
    account: { id: accountRow.id, balanceMinor: "99000" },
  });

  const edit = await page.request.patch(
    `${api}/transactions/${refundExpenseResult.transaction.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `transaction-edit-test-${testRun}`,
      },
      data: {
        kind: "EXPENSE",
        sourceAccountId: accountRow.id,
        categoryId: expenseCategory.id,
        amountMinor: "4000",
        occurredOn: "2026-10-22",
        reason: "Corrected receipt total",
      },
    },
  );
  expect(edit.status()).toBe(200);
  const editResult = await edit.json();
  expect(typeof editResult.requestId).toBe("string");
  expect(editResult).toMatchObject({
    transaction: { currentRevision: 2, status: "POSTED" },
    account: { id: accountRow.id, balanceMinor: "100000" },
  });
  const audit = await page.request.get(
    `${api}/transactions/${refundExpenseResult.transaction.id}/audit`,
  );
  expect(audit.status()).toBe(200);
  await expect(audit.json()).resolves.toMatchObject({
    revisions: [
      { version: 1 },
      { version: 2, reason: "Corrected receipt total" },
    ],
  });

  const blockedVoid = await page.request.delete(
    `${api}/transactions/${refundExpenseResult.transaction.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `transaction-delete-refunded-expense-${testRun}`,
      },
      data: { reason: "Must void refund first" },
    },
  );
  expect(blockedVoid.status()).toBe(409);

  const refundVoided = await page.request.delete(
    `${api}/transactions/${refundResult.transaction.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `transaction-delete-refund-${testRun}`,
      },
      data: { reason: "Reverse merchant refund before voiding expense" },
    },
  );
  expect(refundVoided.status()).toBe(200);
  await expect(refundVoided.json()).resolves.toMatchObject({
    transaction: { kind: "REFUND", status: "VOID" },
  });

  const voided = await page.request.delete(
    `${api}/transactions/${refundExpenseResult.transaction.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": csrfToken,
        "idempotency-key": `transaction-delete-test-${testRun}`,
      },
      data: { reason: "Remove duplicate entry" },
    },
  );
  expect(voided.status()).toBe(200);
  await expect(voided.json()).resolves.toMatchObject({
    transaction: { currentRevision: 3, status: "VOID" },
  });
  const reread = await page.request.get(
    `${api}/transactions/${refundExpenseResult.transaction.id}`,
  );
  expect(reread.status()).toBe(200);
  await expect(reread.json()).resolves.toMatchObject({
    transaction: { status: "VOID", currentRevision: 3 },
  });
});

test("reports, exports, security, and categories stay owner-scoped", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  const login = await page.request.post(apiUrl("/auth/login"), {
    headers: { origin },
    data: {
      email: "second@example.test",
      password: "CI-only-second-user-password-never-used",
    },
  });
  expect(login.status()).toBe(200);
  const report = await page.request.get(
    apiUrl("/reports/monthly?month=2026-10"),
  );
  expect(report.status()).toBe(200);
  await expect(report.json()).resolves.toMatchObject({
    report: {
      month: "2026-10",
      incomeMinor: expect.any(String),
      netExpensesMinor: expect.any(String),
      netCashFlowMinor: expect.any(String),
    },
  });
  const csv = await page.request.get(apiUrl("/exports/transactions.csv"));
  expect(csv.status()).toBe(200);
  expect(csv.headers()["cache-control"]).toBe("private, no-store");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain(
    "monikey-transactions.csv",
  );
  const json = await page.request.get(apiUrl("/exports/data.json"));
  expect(json.status()).toBe(200);
  expect(json.headers()["cache-control"]).toBe("private, no-store");
  await expect(json.json()).resolves.toMatchObject({
    schemaVersion: "monikey-v2.export.v1",
    owner: { timezone: "Asia/Manila", currency: "PHP" },
  });
  await page.goto("/app/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await page.goto("/app/settings/security");
  await expect(
    page.getByRole("heading", { name: "Security you can review." }),
  ).toBeVisible();
  await page.goto("/app/settings/categories");
  await expect(
    page.getByRole("heading", { name: "Categories that keep context." }),
  ).toBeVisible();
});

test("reports keep month data isolated and retry the selected month", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const login = await page.request.post(apiUrl("/auth/login"), {
    headers: { origin: webOrigin },
    data: {
      email: "owner@example.test",
      password: "CI-only-password-never-used-outside-tests",
    },
  });
  expect(login.status()).toBe(200);
  let delayAugust = false;
  let augustRequests = 0;
  let failJulyOnce = true;
  await page.route("**/api/v1/reports/monthly?month=2026-08", async (route) => {
    augustRequests += 1;
    if (delayAugust) await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.route("**/api/v1/reports/monthly?month=2026-07", async (route) => {
    if (failJulyOnce) {
      failJulyOnce = false;
      await route.abort("failed");
    } else await route.continue();
  });

  await page.goto("/app/reports");
  const monthInput = page.locator("input[type=month]");
  await expect(page.locator("[data-report-month]")).toBeVisible();
  const initialMonth = await monthInput.inputValue();
  await monthInput.fill("");
  await expect(monthInput).toHaveValue(initialMonth);
  delayAugust = true;
  await monthInput.fill("2026-08");
  await expect.poll(() => augustRequests).toBe(1);
  await expect(page.locator("[data-report-month]")).toHaveCount(0);
  await monthInput.fill("2026-09");
  await expect(page.locator('[data-report-month="2026-09"]')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-report-month="2026-09"]')).toBeVisible();

  await monthInput.fill("2026-07");
  await expect(page.getByRole("alert")).toContainText(
    "Report unavailable for 2026-07",
  );
  await expect(page.locator("[data-report-month]")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator('[data-report-month="2026-07"]')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/transactions/new");
  const amountInput = page.getByLabel("Amount");
  await expect(amountInput).toBeVisible();
  const amountInputTop = await amountInput.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(amountInputTop).toBeLessThan(420);
  await page.goto("/app/activity");
  const filterToggle = page.getByRole("button", { name: /Filters/ });
  await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Type")).toBeHidden();
  await filterToggle.click();
  await expect(page.getByLabel("Type")).toBeVisible();
});

test("login rate limits repeated failures", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = webOrigin;
  let lastResponse: APIResponse | undefined;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastResponse = await page.request.post(apiUrl("/auth/login"), {
      headers: { origin },
      data: { email: "rate-limit@example.test", password: "wrong-password" },
    });
  }
  if (!lastResponse) throw new Error("The rate limit request did not run.");
  expect(lastResponse.status()).toBe(429);
  await expect(lastResponse.json()).resolves.toMatchObject({
    error: { code: "RATE_LIMITED" },
  });
});
