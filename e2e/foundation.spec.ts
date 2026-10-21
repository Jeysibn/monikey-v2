import { expect, test } from "@playwright/test";

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
  const loginUrl = "http://127.0.0.1:3000/api/v1/auth/login";
  const rejectedOrigin = await page.request.post(loginUrl, {
    headers: { origin: "https://attacker.example" },
    data: {
      email: "owner@example.test",
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
    "http://127.0.0.1:3000/api/v1/auth/csrf",
  );
  expect(csrfRecovery.status()).toBe(200);
  await expect(csrfRecovery.json()).resolves.toEqual({ csrfToken });

  const profile = await page.request.get("http://127.0.0.1:3000/api/v1/me");
  expect(profile.status()).toBe(200);
  expect(profile.headers()["cache-control"]).toBe("no-store");
  await expect(profile.json()).resolves.toMatchObject({
    user: {
      emailNormalized: "owner@example.test",
      timezone: "Asia/Manila",
      currency: "PHP",
    },
  });

  const sessions = await page.request.get(
    "http://127.0.0.1:3000/api/v1/auth/sessions",
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
      "http://127.0.0.1:3000/api/v1/auth/sessions",
    );
    const activeSessions = (await bothSessions.json()).sessions;
    expect(activeSessions).toHaveLength(2);
    const oldSession = activeSessions.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(oldSession).toBeDefined();
    if (!oldSession) throw new Error("The original session was not listed.");

    const revoke = await secondContext.request.delete(
      `http://127.0.0.1:3000/api/v1/auth/sessions/${oldSession.id}`,
      { headers: { origin, "x-csrf-token": secondCsrfToken } },
    );
    expect(revoke.status()).toBe(204);
    expect(
      (await page.request.get("http://127.0.0.1:3000/api/v1/me")).status(),
    ).toBe(401);

    const missingCsrf = await secondContext.request.post(
      "http://127.0.0.1:3000/api/v1/auth/logout",
      { headers: { origin } },
    );
    expect(missingCsrf.status()).toBe(403);

    const changedPassword = await secondContext.request.post(
      "http://127.0.0.1:3000/api/v1/auth/change-password",
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

    const logout = await secondContext.request.post(
      "http://127.0.0.1:3000/api/v1/auth/logout",
      { headers: { origin, "x-csrf-token": finalCsrfToken } },
    );
    expect(logout.status()).toBe(204);
    expect(
      (
        await secondContext.request.get("http://127.0.0.1:3000/api/v1/me")
      ).status(),
    ).toBe(401);
  } finally {
    await secondContext.close();
  }
});

test("login rate limits repeated failures", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-chromium");
  const origin = "http://localhost:5173";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await page.request.post(
      "http://127.0.0.1:3000/api/v1/auth/login",
      {
        headers: { origin },
        data: { email: "rate-limit@example.test", password: "wrong-password" },
      },
    );
    lastStatus = response.status();
  }
  expect(lastStatus).toBe(429);
});
