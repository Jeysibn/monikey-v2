import { expect, test } from "@playwright/test";

test("renders an honest empty foundation without sample finances", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Your money deserves a ledger you can trust.",
    }),
  ).toBeVisible();
  await expect(page.getByText("No financial data yet")).toBeVisible();
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

test("invalid requests use the shared API error contract", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.post("/api/v1/diagnostics/echo", {
    data: { message: "" },
  });
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      requestId: expect.any(String),
      details: expect.arrayContaining([
        expect.objectContaining({
          path: "/message",
          message: expect.any(String),
        }),
      ]),
    },
  });
});

test("valid diagnostic request returns its typed response", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.post("/api/v1/diagnostics/echo", {
    data: { message: "contract probe" },
  });
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ message: "contract probe" });
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
