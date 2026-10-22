import assert from "node:assert/strict";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const pageOrigin =
  process.env.MONIKEY_REVIEW_PAGE_ORIGIN ?? "http://localhost:5173";
const apiOrigin =
  process.env.MONIKEY_REVIEW_API_ORIGIN ?? "http://localhost:3000";
const email = process.env.MONIKEY_REVIEW_EMAIL ?? "second@example.test";
const password =
  process.env.MONIKEY_REVIEW_PASSWORD ??
  "CI-only-second-user-password-never-used";
const routes = [
  ["reports", "/app/reports", "Reports that reconcile."],
  ["security", "/app/settings/security", "Security you can review."],
  ["categories", "/app/settings/categories", "Categories that keep context."],
];
const viewports = [
  {
    name: "desktop-1440",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
  },
  { name: "pixel7", viewport: { width: 412, height: 915 }, isMobile: true },
];

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0
  );
}

const browser = await chromium.launch();
const reviewResults = [];

try {
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  const login = await loginPage.request.post(`${apiOrigin}/api/v1/auth/login`, {
    headers: { origin: pageOrigin },
    data: { email, password },
  });
  assert.equal(login.status(), 200, "The disposable review user must sign in.");
  const storageState = await loginContext.storageState();
  await loginContext.close();

  for (const target of viewports) {
    const context = await browser.newContext({
      viewport: target.viewport,
      isMobile: target.isMobile,
      hasTouch: target.isMobile,
      deviceScaleFactor: target.isMobile ? 2 : 1,
      storageState,
    });
    await context.addInitScript(() => {
      window.__monikeyReviewVitals = { lcpMs: 0, cumulativeLayoutShift: 0 };
      try {
        new PerformanceObserver((list) => {
          const latest = list.getEntries().at(-1);
          if (latest) window.__monikeyReviewVitals.lcpMs = latest.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        // LCP is optional on browsers without support.
      }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!("hadRecentInput" in entry) || !entry.hadRecentInput) {
              window.__monikeyReviewVitals.cumulativeLayoutShift +=
                entry.value ?? 0;
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {
        // Layout shift is optional on browsers without support.
      }
    });
    const page = await context.newPage();
    let pageErrorCount = 0;
    let apiErrorCount = 0;
    page.on("pageerror", () => {
      pageErrorCount += 1;
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) {
        apiErrorCount += 1;
      }
    });

    const apiDurations = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      const response = await page.request.get(
        `${apiOrigin}/api/v1/reports/monthly?month=2026-10`,
      );
      apiDurations.push(Math.round(performance.now() - started));
      assert.equal(response.status(), 200, "The reports API must respond.");
    }

    const routeResults = [];
    for (const [name, path, heading] of routes) {
      await page.goto(`${pageOrigin}${path}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("heading", { name: heading }).waitFor({
        state: "visible",
      });
      await page.waitForTimeout(100);
      const pageErrorsBefore = pageErrorCount;
      const apiErrorsBefore = apiErrorCount;
      const metrics = await page.evaluate(() => {
        const interactive = Array.from(
          document.querySelectorAll("a,button,input,select,textarea"),
        );
        const unnamed = interactive.filter((element) => {
          if (
            element instanceof HTMLInputElement &&
            element.type === "hidden"
          ) {
            return false;
          }
          return (
            !element.getAttribute("aria-label") &&
            !element.textContent?.trim() &&
            !(element instanceof HTMLInputElement && element.labels?.length)
          );
        });
        const undersized = interactive.filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.width < 44 || rect.height < 44)
          );
        });
        const navigation = performance.getEntriesByType("navigation")[0];
        const firstContentfulPaint = performance
          .getEntriesByType("paint")
          .find((entry) => entry.name === "first-contentful-paint");
        const largestContentfulPaint = performance
          .getEntriesByType("largest-contentful-paint")
          .at(-1);
        const cumulativeLayoutShift = performance
          .getEntriesByType("layout-shift")
          .reduce(
            (total, entry) =>
              total +
              ("hadRecentInput" in entry && entry.hadRecentInput
                ? 0
                : Number(entry.value ?? 0)),
            0,
          );
        return {
          overflowPx:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          interactive: interactive.length,
          unnamed: unnamed.length,
          undersized: undersized.length,
          domContentLoadedMs: Math.round(
            navigation?.domContentLoadedEventEnd ?? 0,
          ),
          firstContentfulPaintMs: Math.round(
            firstContentfulPaint?.startTime ?? 0,
          ),
          largestContentfulPaintMs: Math.round(
            window.__monikeyReviewVitals?.lcpMs ??
              largestContentfulPaint?.startTime ??
              0,
          ),
          cumulativeLayoutShift: Number(
            (
              window.__monikeyReviewVitals?.cumulativeLayoutShift ??
              cumulativeLayoutShift
            ).toFixed(3),
          ),
        };
      });
      const routePageErrors = pageErrorCount - pageErrorsBefore;
      const routeApiErrors = apiErrorCount - apiErrorsBefore;
      assert.ok(metrics.overflowPx <= 0, `${name} has horizontal overflow.`);
      assert.equal(metrics.unnamed, 0, `${name} has unnamed controls.`);
      assert.equal(metrics.undersized, 0, `${name} has undersized controls.`);
      assert.equal(routePageErrors, 0, `${name} has page errors.`);
      assert.equal(routeApiErrors, 0, `${name} has API error responses.`);
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      assert.equal(
        accessibility.violations.length,
        0,
        `${name} has WCAG violations: ${JSON.stringify(accessibility.violations)}`,
      );
      routeResults.push({
        name,
        ...metrics,
        pageErrors: routePageErrors,
        apiErrorResponses: routeApiErrors,
        axeViolations: accessibility.violations.length,
      });
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    const reducedMotion = await page.evaluate(() => ({
      matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      bodyTransition: getComputedStyle(document.body).transitionDuration,
      bodyAnimation: getComputedStyle(document.body).animationDuration,
    }));
    assert.equal(reducedMotion.matches, true);
    assert.ok(
      ["0s", "0.01ms", "1e-05s"].includes(reducedMotion.bodyTransition),
    );
    assert.equal(pageErrorCount, 0, `${target.name} has page errors.`);
    assert.equal(apiErrorCount, 0, `${target.name} has API error responses.`);
    reviewResults.push({
      target: target.name,
      routes: routeResults,
      reportApiP95Ms: percentile(apiDurations, 0.95),
      reportApiSamplesMs: apiDurations,
      reducedMotion,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(
  JSON.stringify({ pageOrigin, apiOrigin, results: reviewResults }, null, 2),
);
