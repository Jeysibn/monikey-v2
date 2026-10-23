import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "scale-review.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/scale-review",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
});
