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
