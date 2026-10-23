import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
const screenshotDir = process.env.MONIKEY_REVIEW_SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const routes = [
  ["home", "/app", "Your money, in balance."],
  ["activity", "/app/activity", "Activity that stays traceable."],
  ["quick-add", "/app/transactions/new", "Record it while it is fresh."],
  ["accounts", "/app/accounts", "Accounts you can trace."],
  ["bills", "/app/bills", "Bills with a clear next step."],
  ["settings", "/app/settings", "Settings"],
  ["reports", "/app/reports", "Reports that reconcile."],
  ["security", "/app/settings/security", "Security you can review."],
  ["categories", "/app/settings/categories", "Categories that keep context."],
];
const viewports = [
  { name: "phone-360", viewport: { width: 360, height: 800 }, isMobile: true },
  { name: "phone-390", viewport: { width: 390, height: 844 }, isMobile: true },
  {
    name: "tablet-768",
    viewport: { width: 768, height: 1024 },
    isMobile: false,
  },
  {
    name: "desktop-1440",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
  },
  {
    name: "wide-desktop-1920",
    viewport: { width: 1920, height: 1080 },
    isMobile: false,
  },
];

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0
  );
}

async function assertKeyboardFocus(page, name) {
  const selector =
    'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const keyboardFocusableCount = await page.locator(selector).evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !element.hasAttribute("disabled") &&
          !element.closest("details:not([open])") &&
          styles.visibility !== "hidden" &&
          styles.display !== "none"
        );
      }).length,
  );
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
  const visited = new Set();
  const failures = [];
  for (
    let step = 0;
    visited.size < keyboardFocusableCount && step < keyboardFocusableCount * 3;
    step += 1
  ) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate((focusableSelector) => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const elements = Array.from(document.querySelectorAll(focusableSelector));
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      const parentStyles = element.parentElement
        ? getComputedStyle(element.parentElement)
        : null;
      const hasFocusStyle =
        (styles.outlineWidth !== "0px" && styles.outlineStyle !== "none") ||
        styles.boxShadow !== "none" ||
        (element.parentElement?.classList.contains("amount-control") &&
          parentStyles?.boxShadow !== "none");
      return {
        index: elements.indexOf(element),
        visible: rect.width > 0 && rect.height > 0,
        hasFocusStyle,
      };
    }, selector);
    if (focus && focus.index >= 0 && !visited.has(focus.index)) {
      visited.add(focus.index);
      if (!focus.visible || !focus.hasFocusStyle) failures.push(focus);
    }
  }
  await page.evaluate(() => document.body.removeAttribute("tabindex"));
  assert.equal(
    visited.size,
    keyboardFocusableCount,
    `${name} keyboard traversal missed focusable controls.`,
  );
  assert.equal(
    failures.length,
    0,
    `${name} has keyboard focus failures: ${JSON.stringify(failures)}`,
  );
}

async function resetReviewScrollPosition(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const pageContent = document.querySelector(".page-content");
    if (pageContent instanceof HTMLElement) pageContent.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

async function assertReviewCaptureAtTop(page, name) {
  const position = await page.evaluate(() => {
    const pageContent = document.querySelector(".page-content");
    const topbar = document.querySelector(".topbar");
    const notice = document.querySelector(".preview-notice");
    const topbarBounds = topbar?.getBoundingClientRect();
    const noticeBounds = notice?.getBoundingClientRect();
    return {
      pageScrollTop:
        pageContent instanceof HTMLElement ? pageContent.scrollTop : null,
      windowScrollY: window.scrollY,
      topbarVisible: Boolean(
        topbarBounds &&
          topbarBounds.top >= 0 &&
          topbarBounds.bottom <= window.innerHeight,
      ),
      sessionNoticeVisible: Boolean(
        noticeBounds &&
          noticeBounds.top >= 0 &&
          noticeBounds.bottom <= window.innerHeight,
      ),
    };
  });
  assert.equal(position.pageScrollTop, 0, `${name} capture is scrolled.`);
  assert.equal(position.windowScrollY, 0, `${name} window is scrolled.`);
  assert.equal(
    position.topbarVisible,
    true,
    `${name} capture hides the app header.`,
  );
  assert.equal(
    position.sessionNoticeVisible,
    true,
    `${name} capture hides the session notice.`,
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
      window.__monikeyReviewUnhandledRejections = 0;
      window.addEventListener("unhandledrejection", () => {
        window.__monikeyReviewUnhandledRejections += 1;
      });
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
    let consoleErrorCount = 0;
    let apiNetworkFailureCount = 0;
    page.on("pageerror", () => {
      pageErrorCount += 1;
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrorCount += 1;
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) {
        apiErrorCount += 1;
      }
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/")) apiNetworkFailureCount += 1;
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
      const pageErrorsBefore = pageErrorCount;
      const apiErrorsBefore = apiErrorCount;
      const consoleErrorsBefore = consoleErrorCount;
      const apiNetworkFailuresBefore = apiNetworkFailureCount;
      await page.goto(`${pageOrigin}${path}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("heading", { name: heading }).waitFor({
        state: "visible",
      });
      await page.waitForTimeout(100);
      await resetReviewScrollPosition(page);
      await assertReviewCaptureAtTop(page, name);
      if (name === "home") {
        const amountLetterSpacing = await page
          .locator(".dashboard-balance .money-value")
          .evaluate((element) => getComputedStyle(element).letterSpacing);
        assert.ok(
          !amountLetterSpacing.startsWith("-") &&
            (amountLetterSpacing === "normal" ||
              amountLetterSpacing === "0px" ||
              Number.parseFloat(amountLetterSpacing) >= 0),
          `The PHP symbol and first balance digit must not collide; got ${amountLetterSpacing}.`,
        );
      }
      const captureRouteReview =
        screenshotDir && ["phone-390", "desktop-1440"].includes(target.name);
      if (screenshotDir && (captureRouteReview || name === "home")) {
        await page.screenshot({
          path: join(screenshotDir, `${name}-${target.name}-light.png`),
          animations: "disabled",
        });
      }
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
          // A native checkbox or radio is intentionally small visually, but
          // its associated label is the interactive touch target.
          const target =
            element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio")
              ? (element.closest("label") ?? element)
              : element;
          const rect = target.getBoundingClientRect();
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
          unhandledRejections: window.__monikeyReviewUnhandledRejections ?? 0,
        };
      });
      const routePageErrors = pageErrorCount - pageErrorsBefore;
      const routeApiErrors = apiErrorCount - apiErrorsBefore;
      const routeConsoleErrors = consoleErrorCount - consoleErrorsBefore;
      const routeApiNetworkFailures =
        apiNetworkFailureCount - apiNetworkFailuresBefore;
      assert.ok(metrics.overflowPx <= 0, `${name} has horizontal overflow.`);
      assert.equal(metrics.unnamed, 0, `${name} has unnamed controls.`);
      assert.equal(metrics.undersized, 0, `${name} has undersized controls.`);
      assert.equal(routePageErrors, 0, `${name} has page errors.`);
      assert.equal(routeApiErrors, 0, `${name} has API error responses.`);
      assert.equal(
        routeConsoleErrors,
        0,
        `${name} has browser console errors.`,
      );
      assert.equal(
        routeApiNetworkFailures,
        0,
        `${name} has failed API requests.`,
      );
      assert.equal(
        metrics.unhandledRejections,
        0,
        `${name} has unhandled promise rejections.`,
      );
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      assert.equal(
        accessibility.violations.length,
        0,
        `${name} has WCAG violations: ${JSON.stringify(accessibility.violations)}`,
      );
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await page.waitForTimeout(300);
      const darkAccessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      assert.equal(
        darkAccessibility.violations.length,
        0,
        `${name} has dark-theme WCAG violations: ${JSON.stringify(darkAccessibility.violations)}`,
      );
      if (screenshotDir && (captureRouteReview || name === "home")) {
        await resetReviewScrollPosition(page);
        await assertReviewCaptureAtTop(page, `${name} dark`);
        await page.screenshot({
          path: join(screenshotDir, `${name}-${target.name}-dark.png`),
          animations: "disabled",
        });
      }
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
      });
      const keyboardFocusableCount = await page
        .locator(
          'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
        )
        .evaluateAll(
          (elements) =>
            elements.filter((element) => {
              const rect = element.getBoundingClientRect();
              const styles = getComputedStyle(element);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                !element.hasAttribute("disabled") &&
                !element.closest("details:not([open])") &&
                styles.visibility !== "hidden" &&
                styles.display !== "none"
              );
            }).length,
        );
      await page.evaluate(() => {
        document.body.setAttribute("tabindex", "-1");
        document.body.focus();
      });
      const keyboardFocusFailures = [];
      const visitedKeyboardTargets = new Set();
      let keyboardTabSteps = 0;
      while (
        visitedKeyboardTargets.size < keyboardFocusableCount &&
        keyboardTabSteps < keyboardFocusableCount * 3
      ) {
        keyboardTabSteps += 1;
        await page.keyboard.press("Tab");
        const focusState = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement)) return null;
          const focusableElements = Array.from(
            document.querySelectorAll(
              'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
            ),
          );
          const rect = element.getBoundingClientRect();
          const styles = getComputedStyle(element);
          const parent = element.parentElement;
          const parentStyles = parent ? getComputedStyle(parent) : null;
          const hasFocusStyle =
            (styles.outlineWidth !== "0px" && styles.outlineStyle !== "none") ||
            styles.boxShadow !== "none" ||
            (parent?.classList.contains("amount-control") &&
              parentStyles?.boxShadow !== "none");
          return {
            focusableIndex: focusableElements.indexOf(element),
            tag: element.tagName,
            className: element.className,
            text: element.textContent?.trim().slice(0, 40) ?? "",
            visible: rect.width > 0 && rect.height > 0,
            hasFocusStyle,
          };
        });
        if (
          focusState &&
          focusState.focusableIndex >= 0 &&
          !visitedKeyboardTargets.has(focusState.focusableIndex)
        ) {
          visitedKeyboardTargets.add(focusState.focusableIndex);
          if (!focusState.visible || !focusState.hasFocusStyle) {
            keyboardFocusFailures.push(focusState);
          }
        }
      }
      if (visitedKeyboardTargets.size !== keyboardFocusableCount) {
        keyboardFocusFailures.push({
          reason: "Tab traversal did not visit every visible focusable control",
          visited: visitedKeyboardTargets.size,
          expected: keyboardFocusableCount,
        });
      }
      if (keyboardFocusFailures.length) {
        await page.evaluate(() => document.body.removeAttribute("tabindex"));
        assert.equal(
          keyboardFocusFailures.length,
          0,
          `${name} has keyboard focus failures: ${JSON.stringify(keyboardFocusFailures)}`,
        );
      } else {
        await page.evaluate(() => document.body.removeAttribute("tabindex"));
      }
      routeResults.push({
        name,
        ...metrics,
        keyboardFocusableCount,
        keyboardFocusFailures: keyboardFocusFailures.length,
        pageErrors: routePageErrors,
        apiErrorResponses: routeApiErrors,
        consoleErrors: routeConsoleErrors,
        apiNetworkFailures: routeApiNetworkFailures,
        axeViolations: accessibility.violations.length,
        darkThemeAxeViolations: darkAccessibility.violations.length,
      });
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    const reducedMotion = await page.evaluate(() => {
      const animationProbe = document.createElement("div");
      animationProbe.className = "skeleton-line";
      const transitionProbe = document.createElement("div");
      transitionProbe.className = "amount-control";
      document.body.append(animationProbe, transitionProbe);
      const result = {
        matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        bodyTransition: getComputedStyle(document.body).transitionDuration,
        probeTransition: getComputedStyle(transitionProbe).transitionDuration,
        probeAnimation: getComputedStyle(animationProbe).animationDuration,
        probeAnimationIterations:
          getComputedStyle(animationProbe).animationIterationCount,
        unhandledRejections: window.__monikeyReviewUnhandledRejections ?? 0,
      };
      animationProbe.remove();
      transitionProbe.remove();
      return result;
    });
    assert.equal(reducedMotion.matches, true);
    assert.equal(
      reducedMotion.unhandledRejections,
      0,
      `${target.name} has unhandled promise rejections.`,
    );
    assert.ok(
      ["0s", "0.01ms", "1e-05s"].includes(reducedMotion.bodyTransition),
    );
    assert.ok(
      ["0.01ms", "1e-05s"].includes(reducedMotion.probeTransition),
      `${target.name} amount-control transition did not honor reduced motion.`,
    );
    assert.ok(
      ["0.01ms", "1e-05s"].includes(reducedMotion.probeAnimation),
      `${target.name} skeleton animation did not honor reduced motion.`,
    );
    assert.equal(reducedMotion.probeAnimationIterations, "1");
    assert.equal(pageErrorCount, 0, `${target.name} has page errors.`);
    assert.equal(apiErrorCount, 0, `${target.name} has API error responses.`);
    assert.equal(consoleErrorCount, 0, `${target.name} has console errors.`);
    assert.equal(
      apiNetworkFailureCount,
      0,
      `${target.name} has failed API requests.`,
    );
    reviewResults.push({
      target: target.name,
      routes: routeResults,
      reportApiP95Ms: percentile(apiDurations, 0.95),
      reportApiSamplesMs: apiDurations,
      reducedMotion,
    });
    await context.close();
  }

  {
    const fixtureContext = await browser.newContext({ storageState });
    const fixturePage = await fixtureContext.newPage();
    const csrfResponse = await fixturePage.request.get(
      `${apiOrigin}/api/v1/auth/csrf`,
    );
    assert.equal(
      csrfResponse.status(),
      200,
      "The review CSRF token must load.",
    );
    const { csrfToken } = await csrfResponse.json();
    assert.ok(csrfToken, "The authenticated review session must have CSRF.");
    const createAccount = async (key, account) => {
      const response = await fixturePage.request.post(
        `${apiOrigin}/api/v1/accounts`,
        {
          headers: {
            origin: pageOrigin,
            "x-csrf-token": decodeURIComponent(csrfToken),
            "idempotency-key": key,
          },
          data: account,
        },
      );
      assert.equal(
        response.status(),
        201,
        "Disposable account creation must succeed.",
      );
      return (await response.json()).account;
    };
    const bank = await createAccount("local-review-bank-20261023", {
      type: "BANK",
      name: "Daily Bank",
      institution: "Local Review",
      openingBalanceMinor: "2500000",
    });
    const card = await createAccount("local-review-card-20261023", {
      type: "CREDIT_CARD",
      name: "Travel Card",
      institution: "Local Review",
      openingBalanceMinor: "125000",
      creditLimitMinor: "1000000",
      statementDay: 15,
      dueDay: 2,
    });
    const createStatement = await fixturePage.request.post(
      `${apiOrigin}/api/v1/credit-cards/${card.id}/statements`,
      {
        headers: {
          origin: pageOrigin,
          "x-csrf-token": decodeURIComponent(csrfToken),
          "idempotency-key": "local-review-statement-20261023",
        },
        data: {
          statementDate: "2026-10-20",
          periodStart: "2026-09-20",
          periodEnd: "2026-10-19",
          amountDueMinor: "125000",
          paymentDueDate: "2026-11-02",
          note: "Disposable review fixture",
        },
      },
    );
    assert.equal(
      createStatement.status(),
      201,
      "Disposable card statement creation must succeed.",
    );

    for (const target of viewports) {
      const context = await browser.newContext({
        viewport: target.viewport,
        isMobile: target.isMobile,
        hasTouch: target.isMobile,
        deviceScaleFactor: target.isMobile ? 2 : 1,
        storageState,
      });
      const page = await context.newPage();
      await context.addInitScript(() => {
        window.__monikeyReviewUnhandledRejections = 0;
        window.addEventListener("unhandledrejection", () => {
          window.__monikeyReviewUnhandledRejections += 1;
        });
      });
      let pageErrorCount = 0;
      let apiErrorCount = 0;
      let consoleErrorCount = 0;
      let apiNetworkFailureCount = 0;
      page.on("pageerror", () => {
        pageErrorCount += 1;
      });
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrorCount += 1;
      });
      page.on("response", (response) => {
        if (response.url().includes("/api/") && response.status() >= 400) {
          apiErrorCount += 1;
        }
      });
      page.on("requestfailed", (request) => {
        if (request.url().includes("/api/")) apiNetworkFailureCount += 1;
      });
      for (const [name, path, heading] of [
        ["account-detail", `/app/accounts/${bank.id}`, "Daily Bank"],
        [
          "card-statements",
          `/app/accounts/${card.id}/statements`,
          "Travel Card statements.",
        ],
      ]) {
        await page.goto(`${pageOrigin}${path}`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("heading", { name: heading })
          .waitFor({ state: "visible" });
        await page.waitForTimeout(100);
        const routeMetrics = await page.evaluate(() => {
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
            const target =
              element instanceof HTMLInputElement &&
              (element.type === "checkbox" || element.type === "radio")
                ? (element.closest("label") ?? element)
                : element;
            const rect = target.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              (rect.width < 44 || rect.height < 44)
            );
          });
          return {
            overflowPx:
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            unnamed: unnamed.length,
            undersized: undersized.length,
          };
        });
        assert.ok(
          routeMetrics.overflowPx <= 0,
          `${name} has horizontal overflow.`,
        );
        assert.equal(routeMetrics.unnamed, 0, `${name} has unnamed controls.`);
        assert.equal(
          routeMetrics.undersized,
          0,
          `${name} has undersized controls.`,
        );
        await assertKeyboardFocus(page, `${name} (${target.name})`);
        await resetReviewScrollPosition(page);
        await assertReviewCaptureAtTop(page, name);

        const themeViolations = {};
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await page.waitForTimeout(100);
          const accessibility = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
            .analyze();
          themeViolations[theme] = accessibility.violations.length;
          assert.equal(
            accessibility.violations.length,
            0,
            `${name} (${theme}) has WCAG violations: ${JSON.stringify(accessibility.violations)}`,
          );
          if (screenshotDir) {
            await page.screenshot({
              path: join(screenshotDir, `${name}-${target.name}-${theme}.png`),
              animations: "disabled",
            });
          }
        }
        assert.equal(
          await page.evaluate(
            () => window.__monikeyReviewUnhandledRejections ?? 0,
          ),
          0,
          `${name} has unhandled promise rejections.`,
        );
        assert.equal(pageErrorCount, 0, `${name} has page errors.`);
        assert.equal(apiErrorCount, 0, `${name} has API error responses.`);
        assert.equal(consoleErrorCount, 0, `${name} has console errors.`);
        assert.equal(
          apiNetworkFailureCount,
          0,
          `${name} has failed API requests.`,
        );
        reviewResults.push({
          target: `${target.name}-${name}`,
          routes: [{ name, ...routeMetrics, axeViolations: themeViolations }],
        });
      }
      await context.close();
    }
    await fixtureContext.close();
  }
} finally {
  await browser.close();
}

console.log(
  JSON.stringify({ pageOrigin, apiOrigin, results: reviewResults }, null, 2),
);
