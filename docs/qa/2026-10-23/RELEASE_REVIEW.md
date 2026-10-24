# Local release review

Updated: 2026-10-23

Run the review on the isolated tmpfs E2E stack. This leaves the development database and services untouched:

```sh
npm run e2e:stack:up
docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e MONIKEY_BOOTSTRAP_EMAIL=owner@example.test \
  -e MONIKEY_BOOTSTRAP_PASSWORD=CI-only-password-never-used-outside-tests \
  api npm run bootstrap-owner --workspace @monikey/api
docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=second@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-second-user-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api
MONIKEY_REVIEW_PAGE_ORIGIN=http://localhost:18080 \
MONIKEY_REVIEW_API_ORIGIN=http://localhost:13000 \
MONIKEY_REVIEW_SCREENSHOT_DIR=/path/to/vault/Projects/Monikey\ V2/Assets/Responsive\ Review npm run review:local
npm run e2e:stack:down
```

Install the Playwright Chromium browser once with `npx playwright install chromium`.

The review uses the real API, PostgreSQL, and Playwright Chromium. Its current responsive matrix checks the complete authenticated route surface—Home, Activity, Quick Add, Accounts, Bills, Settings, Reports, Security, and Categories—at 360px, 390px, 768px, 1440px, and 1920px. Earlier 1440px/412px baselines below are historical runs. It verifies the expected headings, no horizontal overflow, no unnamed interactive controls, 44px minimum interactive targets, WCAG 2A/2AA axe violations in both themes, keyboard traversal and visible focus styling, reduced-motion styles, FCP/LCP/CLS web-vital samples, page errors, API error responses, and five report API requests per viewport. Native checkbox and radio controls are measured through their associated label touch target; closed mobile menu items are excluded until opened.

## Baseline captured locally

| Viewport            | Report API p95 | Route DOM-content-loaded range | Overflow | Unnamed controls | Undersized controls |
| ------------------- | -------------: | -----------------------------: | -------: | ---------------: | ------------------: |
| Desktop 1440        |          21 ms |                      25–766 ms |     0 px |                0 |                   0 |
| Pixel 7-sized 412px |          12 ms |                       25–99 ms |     0 px |                0 |                   0 |

The axe scan reported zero WCAG 2A/2AA violations in both light and dark themes across all 18 route/viewport combinations (36 theme scans). Keyboard traversal visited every visible focusable control with zero focus-style failures across the same 18 route/viewport combinations. Reduced-motion emulation matched `prefers-reduced-motion: reduce` on both viewports and reduced body transition/animation duration to Chromium’s `1e-05s` representation of `0.01ms`.

A later rerun after making the harness authenticate once and reuse Playwright storage state also passed locally across all 18 route/viewport combinations. It reported zero overflow, unnamed controls, undersized targets, axe violations, page errors, and API error responses. The latest web-vitals/error samples were:

| Viewport            | FCP range | LCP range |     CLS | Page errors | API error responses |
| ------------------- | --------: | --------: | ------: | ----------: | ------------------: |
| Desktop 1440        | 56–152 ms | 56–472 ms | 0–0.003 |           0 |                   0 |
| Pixel 7-sized 412px | 52–244 ms | 52–244 ms |       0 |           0 |                   0 |

LCP is captured with an initialization-time `PerformanceObserver`; these are repeatable local-development measurements rather than production budgets. The first full-surface run found and fixed undersized Activity privacy controls and filter actions, Quick Add mode tabs, dashboard links, and a mobile Settings privacy control before reaching this passing baseline.

This is an automated release baseline and interaction sweep. A full WCAG audit, screen-reader walkthrough, real-device review, and owner sign-off remain required before the Phase 5 exit gate. The measurements are local development evidence, not a production performance promise.

## Current five-width result — 2026-10-23

The latest run covered 55 route/viewport combinations: nine authenticated routes plus Account Detail and Card Statements at 360, 390, 768, 1440, and 1920px. All 110 light/dark axe scans, configured with WCAG 2.0 A/AA and WCAG 2.2 AA tags, reported zero violations. Keyboard focus, reduced motion, overflow, accessible naming, 44px target size, and page/API error checks passed at every width. The harness now separately fails on browser console errors, unhandled promise rejections, and failed API network requests; all three counts were zero across the full matrix. A previous five-width run recorded report API p95 observations of 19ms at 360px, 16ms at 390px, 12ms at 768px, 10ms at 1440px, and 12ms at 1920px; those local development timings vary by run and are not production budgets. See the full record in `docs/qa/history/TESTING_HISTORY.md`. Axe automation is not a full WCAG conformance audit. Actual-device, screen-reader, human contrast, and owner sign-off remain open.

### Effect-level reduced-motion verification — 2026-10-23

The current `npm run review:local` run uses the actual `.skeleton-line` and
`.amount-control` classes as animation/transition probes after applying
`prefers-reduced-motion: reduce`. It asserts both computed durations are
0.01ms and the skeleton animation runs once. All five viewport passes reported
the expected values, alongside 45 route checks and 90 clean axe scans. This
strengthens automated CSS verification; it does not replace motion-quality,
screen-reader, or physical-device review.

### 10,000-transaction Activity scale review — 2026-10-23

After correcting the disposable fixture to post against the source account named in each transaction revision, the fresh current-worktree scale run returned 10,000 unique transaction IDs in 100 pages over 5,022 ms, with 33 ms API page p95. Playwright checked the account ledger-derived balance, rendered 25 rows initially and 50 after “Load more”, and verified a second user could not see the owner transactions or scale account. This is a local development sample, not representative homelab hardware or a production SLO; see `docs/qa/history/TESTING_HISTORY.md` for the seeding guards and full procedure.

## Current owner review screenshots — 2026-10-23

A fresh current-worktree run used the isolated tmpfs PostgreSQL stack and a
disposable second user. All 45 route/viewport checks and 90 light/dark axe
scans passed, with zero overflow, unnamed/undersized controls, keyboard-focus
failures, WCAG 2A/2AA violations, page/API/console errors, failed API requests,
or unhandled rejections. Reduced-motion checks passed at all five widths.
Ten empty-account Home captures (light and dark at 360px, 390px, 768px,
1440px, and 1920px) are included below. The PHP glyph contains horizontal
strokes; this is the currency symbol, not a privacy-mask artifact. Captures
use disposable test identity/data and are automated Chromium emulation. They
do not complete the human phone/desktop, screen-reader, independent QA, or
owner acceptance gates.

### Phone — 360px

| Light                                                                                  | Dark                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Home at 360px, light theme](assets/owner-review-2026-10-23/home-phone-360-light.png) | ![Home at 360px, dark theme](assets/owner-review-2026-10-23/home-phone-360-dark.png) |

### Phone — 390px

| Light                                                                                  | Dark                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Home at 390px, light theme](assets/owner-review-2026-10-23/home-phone-390-light.png) | ![Home at 390px, dark theme](assets/owner-review-2026-10-23/home-phone-390-dark.png) |

### Tablet — 768px

| Light                                                                                   | Dark                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ![Home at 768px, light theme](assets/owner-review-2026-10-23/home-tablet-768-light.png) | ![Home at 768px, dark theme](assets/owner-review-2026-10-23/home-tablet-768-dark.png) |

### Desktop — 1440px

| Light                                                                                      | Dark                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Home at 1440px, light theme](assets/owner-review-2026-10-23/home-desktop-1440-light.png) | ![Home at 1440px, dark theme](assets/owner-review-2026-10-23/home-desktop-1440-dark.png) |

### Wide desktop — 1920px

| Light                                                                                           | Dark                                                                                          |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ![Home at 1920px, light theme](assets/owner-review-2026-10-23/home-wide-desktop-1920-light.png) | ![Home at 1920px, dark theme](assets/owner-review-2026-10-23/home-wide-desktop-1920-dark.png) |

## Authenticated route screenshots — 2026-10-23

The isolated review captured all nine signed-in routes in light and dark themes at 390px phone and 1440px desktop sizes. Home also retains its five-width gallery above. Account Detail and Card Statements use two real accounts created through the authenticated API for the disposable E2E user: a bank account with a PHP 25,000.00 opening balance and a card with a PHP 1,250.00 opening balance and PHP 10,000.00 limit. Those records exist only in the isolated tmpfs PostgreSQL stack, which is removed after review. The desktop shell displays the disposable `second@example.test` identity. These browser captures do not replace owner review on an actual phone or screen-reader review.

| Route           | Phone light                                                                                  | Phone dark                                                                                 | Desktop light                                                                                     | Desktop dark                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Home            | ![Home phone light](assets/full-route-review/home-phone-390-light.png)                       | ![Home phone dark](assets/full-route-review/home-phone-390-dark.png)                       | ![Home desktop light](assets/full-route-review/home-desktop-1440-light.png)                       | ![Home desktop dark](assets/full-route-review/home-desktop-1440-dark.png)                       |
| Activity        | ![Activity phone light](assets/full-route-review/activity-phone-390-light.png)               | ![Activity phone dark](assets/full-route-review/activity-phone-390-dark.png)               | ![Activity desktop light](assets/full-route-review/activity-desktop-1440-light.png)               | ![Activity desktop dark](assets/full-route-review/activity-desktop-1440-dark.png)               |
| Quick Add       | ![Quick Add phone light](assets/full-route-review/quick-add-phone-390-light.png)             | ![Quick Add phone dark](assets/full-route-review/quick-add-phone-390-dark.png)             | ![Quick Add desktop light](assets/full-route-review/quick-add-desktop-1440-light.png)             | ![Quick Add desktop dark](assets/full-route-review/quick-add-desktop-1440-dark.png)             |
| Accounts        | ![Accounts phone light](assets/full-route-review/accounts-phone-390-light.png)               | ![Accounts phone dark](assets/full-route-review/accounts-phone-390-dark.png)               | ![Accounts desktop light](assets/full-route-review/accounts-desktop-1440-light.png)               | ![Accounts desktop dark](assets/full-route-review/accounts-desktop-1440-dark.png)               |
| Bills           | ![Bills phone light](assets/full-route-review/bills-phone-390-light.png)                     | ![Bills phone dark](assets/full-route-review/bills-phone-390-dark.png)                     | ![Bills desktop light](assets/full-route-review/bills-desktop-1440-light.png)                     | ![Bills desktop dark](assets/full-route-review/bills-desktop-1440-dark.png)                     |
| Reports         | ![Reports phone light](assets/full-route-review/reports-phone-390-light.png)                 | ![Reports phone dark](assets/full-route-review/reports-phone-390-dark.png)                 | ![Reports desktop light](assets/full-route-review/reports-desktop-1440-light.png)                 | ![Reports desktop dark](assets/full-route-review/reports-desktop-1440-dark.png)                 |
| Settings        | ![Settings phone light](assets/full-route-review/settings-phone-390-light.png)               | ![Settings phone dark](assets/full-route-review/settings-phone-390-dark.png)               | ![Settings desktop light](assets/full-route-review/settings-desktop-1440-light.png)               | ![Settings desktop dark](assets/full-route-review/settings-desktop-1440-dark.png)               |
| Security        | ![Security phone light](assets/full-route-review/security-phone-390-light.png)               | ![Security phone dark](assets/full-route-review/security-phone-390-dark.png)               | ![Security desktop light](assets/full-route-review/security-desktop-1440-light.png)               | ![Security desktop dark](assets/full-route-review/security-desktop-1440-dark.png)               |
| Categories      | ![Categories phone light](assets/full-route-review/categories-phone-390-light.png)           | ![Categories phone dark](assets/full-route-review/categories-phone-390-dark.png)           | ![Categories desktop light](assets/full-route-review/categories-desktop-1440-light.png)           | ![Categories desktop dark](assets/full-route-review/categories-desktop-1440-dark.png)           |
| Account Detail  | ![Account Detail phone light](assets/full-route-review/account-detail-phone-390-light.png)   | ![Account Detail phone dark](assets/full-route-review/account-detail-phone-390-dark.png)   | ![Account Detail desktop light](assets/full-route-review/account-detail-desktop-1440-light.png)   | ![Account Detail desktop dark](assets/full-route-review/account-detail-desktop-1440-dark.png)   |
| Card Statements | ![Card Statements phone light](assets/full-route-review/card-statements-phone-390-light.png) | ![Card Statements phone dark](assets/full-route-review/card-statements-phone-390-dark.png) | ![Card Statements desktop light](assets/full-route-review/card-statements-desktop-1440-light.png) | ![Card Statements desktop dark](assets/full-route-review/card-statements-desktop-1440-dark.png) |

### Account Detail and Card Statements across five widths

| Route           | 360px phone                                                                                                                                 | 390px phone                                                                                                                                 | 768px tablet                                                                                                                                  | 1440px desktop                                                                                                                                    | 1920px wide desktop                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account Detail  | [light](assets/full-route-review/account-detail-phone-360-light.png) · [dark](assets/full-route-review/account-detail-phone-360-dark.png)   | [light](assets/full-route-review/account-detail-phone-390-light.png) · [dark](assets/full-route-review/account-detail-phone-390-dark.png)   | [light](assets/full-route-review/account-detail-tablet-768-light.png) · [dark](assets/full-route-review/account-detail-tablet-768-dark.png)   | [light](assets/full-route-review/account-detail-desktop-1440-light.png) · [dark](assets/full-route-review/account-detail-desktop-1440-dark.png)   | [light](assets/full-route-review/account-detail-wide-desktop-1920-light.png) · [dark](assets/full-route-review/account-detail-wide-desktop-1920-dark.png)   |
| Card Statements | [light](assets/full-route-review/card-statements-phone-360-light.png) · [dark](assets/full-route-review/card-statements-phone-360-dark.png) | [light](assets/full-route-review/card-statements-phone-390-light.png) · [dark](assets/full-route-review/card-statements-phone-390-dark.png) | [light](assets/full-route-review/card-statements-tablet-768-light.png) · [dark](assets/full-route-review/card-statements-tablet-768-dark.png) | [light](assets/full-route-review/card-statements-desktop-1440-light.png) · [dark](assets/full-route-review/card-statements-desktop-1440-dark.png) | [light](assets/full-route-review/card-statements-wide-desktop-1920-light.png) · [dark](assets/full-route-review/card-statements-wide-desktop-1920-dark.png) |

- Screenshot harness follow-up: keyboard traversal had scrolled the nested page before the next route capture. The local review now clears focus and resets both the page-content scroller and document/window scroll before light and dark captures. The regenerated Activity and Bills phone images include the app brand, session notice, sign-out, route heading, and navigation from the top; they are suitable for owner review.

### Visual review notes

- The first Home capture showed the PHP currency symbol crowded against the first digit at large type sizes. `formatPhp` now inserts a narrow nonbreaking space after the symbol, and the dashboard balance resets its inherited negative tracking. The refreshed light/dark phone and desktop captures show a clear gap; the money formatter unit test protects the display string and the browser review asserts that the dashboard amount does not inherit negative letter spacing.
- On the 390px Activity screen, the large page title wraps to three lines and pushes filters below the first viewport. It remains readable and has no overflow or automated accessibility findings; owner review should judge the balance between title scale and getting to filters quickly.
- The empty 1440px Reports state keeps its content in a narrower left column. It is readable and uses the available month/export controls, but a human review should assess the unused right side once real report content is present.

The latest `npm run review:local` run covered 55 route/viewport combinations: nine authenticated routes, Account Detail, and Card Statements at all five widths (360, 390, 768, 1440, and 1920px). All 110 light/dark axe scans (WCAG 2.0 A/AA and WCAG 2.2 AA) reported zero violations. Overflow, unnamed or undersized controls, keyboard-focus failures, page/API/console errors, failed API requests, and unhandled rejections were also absent; reduced-motion checks passed. This remains emulated browser evidence; physical-device, screen-reader, contrast walkthrough, independent QA, and owner acceptance are open.
