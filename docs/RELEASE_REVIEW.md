# Local release review

Updated: 2026-10-22

Run the repeatable local review after starting Docker Compose and seeding the disposable second user:

```sh
npm run review:local
```

The review uses the real API, PostgreSQL, and Playwright Chromium. It checks the Reports, Security, and Categories routes at a 1440px desktop viewport and a 412px Pixel 7-sized viewport. It verifies the expected headings, no horizontal overflow, no unnamed interactive controls, 44px minimum interactive targets, reduced-motion styles, and five report API requests per viewport.

## Baseline captured locally

| Viewport            | Report API p95 | Route DOM-content-loaded range | Overflow | Unnamed controls | Undersized controls |
| ------------------- | -------------: | -----------------------------: | -------: | ---------------: | ------------------: |
| Desktop 1440        |          26 ms |                      34–112 ms |     0 px |                0 |                   0 |
| Pixel 7-sized 412px |          11 ms |                       37–91 ms |     0 px |                0 |                   0 |

Reduced-motion emulation matched `prefers-reduced-motion: reduce` on both viewports and reduced body transition/animation duration to Chromium’s `1e-05s` representation of `0.01ms`.

This is an automated release baseline and interaction sweep. A full WCAG audit, screen-reader walkthrough, real-device review, and owner sign-off remain required before the Phase 5 exit gate. The measurements are local development evidence, not a production performance promise.
