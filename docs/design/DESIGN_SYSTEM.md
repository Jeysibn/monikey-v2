# MoniKey V2 design system

Status: implemented baseline; owner review on real devices remains open. The palette and route behaviors follow `MONIKEY_V2_MASTER_PLAN.md`; automated responsive/accessibility review is recorded in `docs/qa/2026-10-23/RELEASE_REVIEW.md` and `docs/development/TESTING.md`.

## Direction

Premium minimal, blue-led and finance-readable. Keep daily money entry calm and dense enough to be useful. Use navy for hierarchy, royal blue for primary actions and restrained cyan for focus or data accents. No neon, gamification, decorative 3D, or fictional finance data.

## Color tokens

| Token                | Light     | Dark      | Use                                     |
| -------------------- | --------- | --------- | --------------------------------------- |
| `--brand-primary`    | `#1D4ED8` | `#60A5FA` | Primary buttons and selected navigation |
| `--brand-deep`       | `#122343` | `#DBEAFE` | Brand headings and strong emphasis      |
| `--brand-accent`     | `#0284C7` | `#38BDF8` | Focus ring, restrained data accents     |
| `--surface-page`     | `#F7F9FC` | `#0B1220` | Page background                         |
| `--surface-card`     | `#FFFFFF` | `#142036` | Cards, menus and sheets                 |
| `--surface-muted`    | `#ECF2FA` | `#1C2B44` | Subtle grouped surfaces                 |
| `--text-primary`     | `#10213D` | `#F3F7FF` | Main text and values                    |
| `--text-secondary`   | `#53657E` | `#A9BAD2` | Supporting text                         |
| `--border-default`   | `#DCE5F2` | `#2D405D` | Borders and separators                  |
| `--semantic-income`  | `#16794B` | `#62D39A` | Positive income with text/sign label    |
| `--semantic-expense` | `#B42332` | `#FF8792` | Expense context with text/sign label    |
| `--semantic-warning` | `#8A5200` | `#F6C66D` | Overdue or negative balance context     |

Semantic colors must not be the only cue. Amounts retain signs and adjacent labels. Essential text and indicators must meet WCAG AA against their rendered surface; verify every component state and chart palette before Phase 1 exit.
Informational and connection-status glyphs use `--brand-deep` for text contrast; `--brand-accent` remains on their border as a non-text indicator.

## Type and spacing

- UI type: system sans stack with tabular numerals for monetary amounts; no external font request in the private finance shell.
- Body: 16px/1.5. Secondary labels: 13–14px/1.4. Page titles: 24–32px, compact on mobile. Use tabular figures where values align.
- Spacing uses a 4px base: 4, 8, 12, 16, 24, 32, 40, 48.
- Content width: 1120px maximum. Mobile gutters: 18px at 360–390px; desktop gutters: 32px.
- Touch targets: at least 44×44 CSS px. Focus indicator: 3px high-contrast outline with 3px offset.
- Corners: 8px controls, 12px cards, 16px sheets. Shadows are reserved for overlays, not every card.

## Motion and themes

- Theme values are semantic CSS custom properties; components do not hardcode palette colors.
- Persist the signed-in owner's theme preference through the owner-scoped API; before a saved preference exists, follow `prefers-color-scheme`.
- Use opacity/transform for short state changes (120–220ms). Respect `prefers-reduced-motion`; essential state changes remain immediate and clear.
- Privacy masking is presentation only and never treated as API authorization.

## Navigation and route behavior

The implementation-grounded mobile/desktop structure and route transitions
are mapped in [`LOW_FIDELITY_FLOWS.md`](LOW_FIDELITY_FLOWS.md). That draft is
for owner review; it is not acceptance of the interaction direction.

| Route group                                    | Mobile                                                  | Desktop                     | States required                            |
| ---------------------------------------------- | ------------------------------------------------------- | --------------------------- | ------------------------------------------ |
| `/app` Home                                    | Primary bottom navigation                               | Main content with side rail | Loading, empty, error, unauthorized        |
| `/app/activity`                                | Primary bottom navigation                               | Main content with side rail | Search, filter, empty, error               |
| `/app/transactions/new`                        | Contextual bottom sheet; direct-link full-page fallback | Dialog or full page         | Validation, pending, server error, discard |
| `/app/accounts` and `/app/accounts/:accountId` | Primary bottom navigation, contextual detail            | Main content with side rail | Empty, archived/missing, error             |
| `/app/accounts/:accountId/statements`          | Contextual from card                                    | Main content                | Card-only boundary, empty, error           |
| `/app/bills`, `/app/reports`, `/app/settings`  | Secondary destinations                                  | Main content with side rail | Empty, error, unauthorized                 |
| `/login`, `/onboarding`                        | Full-width forms                                        | Narrow centered forms       | Validation, pending, rate limit, recovery  |
| `*`                                            | In-shell 404                                            | In-shell 404                | Helpful recovery link                      |

The primary mobile navigation has Home, Activity, Add, and Accounts. Add is an action. Bills, Reports, and Settings remain secondary. Activity filters are URL state; deep links and browser back must restore the logical view. Authenticated routes load only the signed-in owner's data; signed-out visitors see private-access guidance and must authenticate before financial data is requested.

## Form and overlay behavior

- Expense defaults to today and requires only amount, account and category; note/merchant are optional.
- Amount entry stays a single form with calculator-friendly input. Parse exact minor units at the boundary; never use floating-point multiplication.
- Sheets close with Escape/backdrop, trap and restore focus, and warn before discarding changed values.
- Every interactive control has visible focus, disabled, loading and error states. Feedback includes a text label and never depends on color alone.
- The amount field uses the shared exact PHP parser; invalid precision and non-positive entries get inline errors. Quick Add submits only with valid owner-scoped accounts/categories through the actual journal-backed API, and asks for explicit confirmation before an expense creates a negative balance.
- Account/category selectors show a disabled empty state when no saved records exist. They must never offer selectable fake finance fixtures.
- `MoneyValue` formats `MoneyMinor` without floating-point conversion and keeps a narrow nonbreaking space between the PHP symbol and digits for legibility at large balance sizes. The dashboard's large balance value must not inherit the heading's negative tracking. `PrivacyMask` toggles presentation only and never replaces API authorization.

## Review checklist

- [x] Automated axe scans tagged WCAG 2.0 A/AA and WCAG 2.2 AA pass on all nine authenticated routes plus Account Detail and Card Statements at five widths in both themes; manual contrast and full conformance review remain.
- [x] Capture and inspect the 360, 390, 768, 1440 and 1920px layouts locally.
- [x] Automated keyboard traversal visits every visible focusable control with visible focus styling across all nine authenticated routes and both detail routes at all five review widths; manual dialog/sheet and screen-reader review remains.
- [x] Automated reduced-motion emulation passes in both viewports; physical-device motion review remains.
- [ ] Owner reviews the navigation and visual direction on actual phone and desktop before Phase 1 exit.

## Current preview captures

These screenshots show the honest foundation preview and are not sample finance data:

- Mobile Pixel 7 emulation: `docs/design/screenshots/home-pixel7-emulation.png`
- Desktop 1440px: `docs/design/screenshots/home-desktop-1440.png`
- Required width captures: `docs/design/screenshots/home-360.png`, `home-390.png`, `home-768.png`, `home-1440.png`, and `home-1920.png`

They are code-reviewed browser captures, not a substitute for owner review on a physical phone.

Additional Phase 1 component previews:

- Quick Add on Pixel 7 emulation with an empty owner's account list: `docs/design/screenshots/quick-add-pixel7-emulation.png`
- Home in dark theme at 1440px: `docs/design/screenshots/home-desktop-dark-1440.png`
