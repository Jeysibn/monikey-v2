# Local release review

Updated: 2026-10-22

Run the repeatable local review after starting Docker Compose with the local test override and seeding the disposable second user:

```sh
npm run review:local
```

The review uses the real API, PostgreSQL, and Playwright Chromium. It checks the complete authenticated route surface—Home, Activity, Quick Add, Accounts, Bills, Settings, Reports, Security, and Categories—at a 1440px desktop viewport and a 412px Pixel 7-sized viewport. It verifies the expected headings, no horizontal overflow, no unnamed interactive controls, 44px minimum interactive targets, WCAG 2A/2AA axe violations, reduced-motion styles, FCP/LCP/CLS web-vital samples, page errors, API error responses, and five report API requests per viewport. Native checkbox and radio controls are measured through their associated label touch target.

## Baseline captured locally

| Viewport            | Report API p95 | Route DOM-content-loaded range | Overflow | Unnamed controls | Undersized controls |
| ------------------- | -------------: | -----------------------------: | -------: | ---------------: | ------------------: |
| Desktop 1440        |          18 ms |                      32–110 ms |     0 px |                0 |                   0 |
| Pixel 7-sized 412px |          15 ms |                      33–109 ms |     0 px |                0 |                   0 |

The axe scan reported zero WCAG 2A/2AA violations in both light and dark themes across all 18 route/viewport combinations (36 theme scans). Reduced-motion emulation matched `prefers-reduced-motion: reduce` on both viewports and reduced body transition/animation duration to Chromium’s `1e-05s` representation of `0.01ms`.

A later rerun after making the harness authenticate once and reuse Playwright storage state also passed locally across all 18 route/viewport combinations. It reported zero overflow, unnamed controls, undersized targets, axe violations, page errors, and API error responses. The latest web-vitals/error samples were:

| Viewport            | FCP range | LCP range |     CLS | Page errors | API error responses |
| ------------------- | --------: | --------: | ------: | ----------: | ------------------: |
| Desktop 1440        | 60–176 ms | 84–324 ms | 0–0.057 |           0 |                   0 |
| Pixel 7-sized 412px | 56–164 ms | 64–256 ms |       0 |           0 |                   0 |

LCP is captured with an initialization-time `PerformanceObserver`; these are repeatable local-development measurements rather than production budgets. The first full-surface run found and fixed undersized Activity privacy controls and filter actions, Quick Add mode tabs, dashboard links, and a mobile Settings privacy control before reaching this passing baseline.

This is an automated release baseline and interaction sweep. A full WCAG audit, screen-reader walkthrough, real-device review, and owner sign-off remain required before the Phase 5 exit gate. The measurements are local development evidence, not a production performance promise.
