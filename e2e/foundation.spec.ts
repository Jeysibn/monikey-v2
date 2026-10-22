import { expect, test, type APIResponse } from "@playwright/test";

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
  await page.getByRole("link", { name: "Add transaction" }).click();
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
  await expect(page.getByLabel("Account")).toBeDisabled();
  await expect(page.getByLabel("Category")).toBeDisabled();

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
  const response = await page.request.get("/api/v1/health");
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    database: "connected",
  });
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
  const origin = "http://localhost:5173";
  const loginUrl = "http://localhost:3000/api/v1/auth/login";
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
  expect(rejectedPassword.headers()["cache-control"]).toBe("no-store");
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

  const csrfRecovery = await page.request.get(
    "http://localhost:3000/api/v1/auth/csrf",
  );
  expect(csrfRecovery.status()).toBe(200);
  await expect(csrfRecovery.json()).resolves.toEqual({ csrfToken });

  const profile = await page.request.get("http://localhost:3000/api/v1/me");
  expect(profile.status()).toBe(200);
  expect(profile.headers()["cache-control"]).toBe("no-store");
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
      "http://localhost:3000/api/v1/onboarding/first-account",
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
      "http://localhost:3000/api/v1/onboarding/first-account",
      { headers: firstAccountHeaders, data: firstAccountInput },
    );
    expect(replayFirstAccount.status()).toBe(201);
  } else {
    const existingAccounts = await page.request
      .get("http://localhost:3000/api/v1/accounts")
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
    "http://localhost:3000/api/v1/onboarding/first-account",
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
    page.request
      .get("http://localhost:3000/api/v1/me")
      .then((response) => response.json()),
  ).resolves.toMatchObject({ onboardingStatus: "READY" });

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
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.locator(".form-success")).toHaveText("Transaction saved.");
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
  await page.goto("/app/transactions/new");
  await page.getByRole("tab", { name: "Transfer" }).click();
  await expect(page.getByText("To account *")).toBeVisible();

  const unsupportedCurrency = await page.request.patch(
    "http://localhost:3000/api/v1/me/preferences",
    {
      headers: { origin, "x-csrf-token": csrfToken },
      data: { currency: "USD" },
    },
  );
  expect(unsupportedCurrency.status()).toBe(400);
  const updatePreferences = await page.request.patch(
    "http://localhost:3000/api/v1/me/preferences",
    {
      headers: { origin, "x-csrf-token": csrfToken },
      data: { theme: "dark", hideBalances: true },
    },
  );
  expect(updatePreferences.status()).toBe(200);
  expect(updatePreferences.headers()["cache-control"]).toBe("no-store");
  await expect(updatePreferences.json()).resolves.toMatchObject({
    preferences: {
      timezone: "Asia/Manila",
      currency: "PHP",
      theme: "dark",
      hideBalances: true,
    },
  });

  await page.clock.install({ time: new Date("2001-01-01T12:00:00.000Z") });
  await page.goto("/");
  const skewedDeviceProfile = await page.evaluate(async () =>
    fetch("/api/v1/me").then((response) => response.json()),
  );
  expect(skewedDeviceProfile.serverToday).toBe(profileData.serverToday);
  await page.clock.install();

  const sessions = await page.request.get(
    "http://localhost:3000/api/v1/auth/sessions",
  );
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
      "http://localhost:3000/api/v1/auth/sessions",
    );
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
      const secondUserProfile = await thirdContext.request.get(
        "http://localhost:3000/api/v1/me",
      );
      await expect(secondUserProfile.json()).resolves.toMatchObject({
        user: { theme: "system", hideBalances: false },
      });
      const crossUserRevoke = await thirdContext.request.delete(
        `http://localhost:3000/api/v1/auth/sessions/${oldSession.id}`,
        { headers: { origin, "x-csrf-token": secondUserCsrfToken } },
      );
      expect(crossUserRevoke.status()).toBe(404);
      expect(
        (await page.request.get("http://localhost:3000/api/v1/me")).status(),
      ).toBe(200);
    } finally {
      await thirdContext.close();
    }

    const revoke = await secondContext.request.delete(
      `http://localhost:3000/api/v1/auth/sessions/${oldSession.id}`,
      { headers: { origin, "x-csrf-token": secondCsrfToken } },
    );
    expect(revoke.status()).toBe(204);
    expect(
      (await page.request.get("http://localhost:3000/api/v1/me")).status(),
    ).toBe(401);

    const missingCsrf = await secondContext.request.post(
      "http://localhost:3000/api/v1/auth/logout",
      { headers: { origin } },
    );
    expect(missingCsrf.status()).toBe(403);

    const changedPassword = await secondContext.request.post(
      "http://localhost:3000/api/v1/auth/change-password",
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
      "http://localhost:3000/api/v1/auth/change-password",
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

    const logout = await secondContext.request.post(
      "http://localhost:3000/api/v1/auth/logout",
      { headers: { origin, "x-csrf-token": restoredCsrfToken } },
    );
    expect(logout.status()).toBe(204);
    expect(
      (
        await secondContext.request.get("http://localhost:3000/api/v1/me")
      ).status(),
    ).toBe(401);
  } finally {
    await secondContext.close();
  }
});

test("financial accounts preserve opening balances, history, and owner scope", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = "http://localhost:5173";
  const api = "http://localhost:3000/api/v1";
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
      balanceMinor: "1000000",
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
  expect(archived.balanceMinor).toBe("1000000");

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
  ).toMatchObject({ archivedAt: archived.archivedAt, balanceMinor: "1000000" });

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

test("categories seed defaults and retain archived history", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = "http://localhost:5173";
  const api = "http://localhost:3000/api/v1";
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

  const ownerLogin = await page.request.post(`${api}/auth/login`, {
    headers: { origin },
    data: {
      email: "owner@example.test",
      password: "CI-only-password-never-used-outside-tests",
    },
  });
  expect(ownerLogin.status()).toBe(200);
  const ownerCsrf = (await ownerLogin.json()).csrfToken as string;
  const foreignPatch = await page.request.patch(
    `${api}/categories/${category.id}`,
    {
      headers: {
        origin,
        "x-csrf-token": ownerCsrf,
        "idempotency-key": "category-foreign-patch-test-0001",
      },
      data: { name: "Foreign category" },
    },
  );
  expect(foreignPatch.status()).toBe(404);
});

test("expense and income commands are balanced and retry-safe", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = "http://localhost:5173";
  const api = "http://localhost:3000/api/v1";
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
  expect(expenseResult).toMatchObject({
    transaction: {
      kind: "EXPENSE",
      categoryId: expenseCategory.id,
      note: "Lunch",
    },
    account: { id: accountRow.id, balanceMinor: "75000" },
  });

  const replay = await page.request.post(`${api}/transactions`, {
    headers: transactionHeaders,
    data: expenseBody,
  });
  expect(replay.status()).toBe(201);
  expect((await replay.json()).transaction.id).toBe(
    expenseResult.transaction.id,
  );

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
  expect((await transferReplay.json()).transaction.id).toBe(
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
  await expect(refund.json()).resolves.toMatchObject({
    transaction: {
      kind: "REFUND",
      categoryId: expenseCategory.id,
      refundedTransactionId: refundExpenseResult.transaction.id,
    },
    account: { id: destinationRow.id, balanceMinor: "11000" },
  });

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
  await expect(edit.json()).resolves.toMatchObject({
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

test("login rate limits repeated failures", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = "http://localhost:5173";
  let lastResponse: APIResponse | undefined;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastResponse = await page.request.post(
      "http://localhost:3000/api/v1/auth/login",
      {
        headers: { origin },
        data: { email: "rate-limit@example.test", password: "wrong-password" },
      },
    );
  }
  if (!lastResponse) throw new Error("The rate limit request did not run.");
  expect(lastResponse.status()).toBe(429);
  await expect(lastResponse.json()).resolves.toMatchObject({
    error: { code: "RATE_LIMITED" },
  });
});
