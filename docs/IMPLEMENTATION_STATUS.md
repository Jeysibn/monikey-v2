# Implementation status

Updated: 2026-10-22. The phase sequence and acceptance gates below come from `MONIKEY_V2_MASTER_PLAN.md`. A source file existing is not equivalent to a work package passing its acceptance gate.

## Current milestone

**Phase 0 — Foundation and engineering guardrails: implemented; required acceptance checks pass. Phase 1 — UX direction and component system: in progress. Phase 2 — identity and preferences: in progress.** Design tokens, route behavior, responsive navigation, themes, exact amount-entry validation, disabled record selectors, and a non-financial privacy-mask preview are implemented. Owner review on real devices remains a Phase 1 exit gate. P2-01 identity passed real-Postgres CI and is promoted to `main`; P2-02 preferences and owner scope are in review. Financial ledger work has not started. No V1 code or data has been imported.

| Work package                                                 | State                                    | Evidence / remaining gate                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-01 New repository and branch policy                       | Implemented                              | Public repository: `https://github.com/Jeysibn/monikey-v2`. Default `main`; `dev` and `main` require PRs and `validate`, `CodeQL`, and `e2e`; conversation resolution is required; force pushes and deletions are disabled.                                       |
| P0-02 npm workspaces                                         | Implemented                              | Lockfile committed; clean-clone `npm ci`, TypeScript validation, and builds pass in GitHub Actions.                                                                                                                                                               |
| P0-03 Architecture/docs templates                            | Implemented                              | Master plan, `PRODUCT.md`, `AGENTS.md`, architecture context, ADR template and decisions, release and test docs.                                                                                                                                                  |
| P0-04 Compose + Postgres + API + web + migration             | Implemented; CI acceptance passed        | Compose runs PostgreSQL 17, Prisma migration, API, and web. Real-stack CI reached service health and applied the baseline migration. Local Compose is unavailable because this environment has no container runtime.                                              |
| P0-05 Contracts, error shape, OpenAPI, typed client          | Implemented; CI acceptance passed        | Shared Zod health/error schemas, Fastify error handling, runtime OpenAPI, generated types, and typed fetch client. Temporary echo route was removed after CodeQL found reflected input.                                                                           |
| P0-06 Lint/format/typecheck/unit/integration/E2E scaffolding | Implemented; CI acceptance passed        | Strict TypeScript, Prettier, exact-money unit tests, Playwright desktop/mobile projects, and required PostgreSQL-backed browser smoke checks. Financial domain DB tests are part of later feature slices.                                                         |
| P0-07 GitHub Actions and security checks                     | Partial                                  | `npm audit`, typecheck, build, unit, format, CodeQL, and real-stack E2E are required. Image publication/provenance and dedicated secret scanning remain.                                                                                                          |
| P0-08 Obsidian working project                               | Implemented                              | V2 vault area contains the full plan, status, decision log, ADRs, work log, release flow, and V1/V2 boundary link.                                                                                                                                                |
| P1-01 Design tokens and theme draft                          | Implemented; review pending              | `docs/design/DESIGN_SYSTEM.md` defines blue/navy light/dark tokens, semantic values, type, spacing, focus, and motion. Contrast and owner approval remain.                                                                                                        |
| P1-02 Route and interaction draft                            | Implemented; review pending              | Design doc covers route, navigation, form and overlay behavior. Real-device/owner review remains.                                                                                                                                                                 |
| P1-03 Responsive shell and theme control                     | Implemented; CI passed                   | Desktop rail, four-action mobile navigation, More menu, theme preference, reduced motion and honest preview status.                                                                                                                                               |
| P1-04 Route skeleton and deep links                          | Implemented; CI passed                   | React Router skeletons, deep-link refresh, history navigation, route boundaries and in-shell 404s pass real-stack CI. Authenticated route guards remain part of first private-alpha UI integration.                                                               |
| P1-05 Amount, selectors and privacy mask                     | Implemented; CI passed                   | Exact PHP amount parsing, no-save preview form, disabled empty account/category selectors and accessible mask control. Production records and mutation remain absent.                                                                                             |
| P1-06 Device screenshots and design acceptance               | Partial                                  | 360/Pixel 7 emulation and 1440px desktop preview captures are saved. Physical phone and owner approval remain.                                                                                                                                                    |
| P2-01 Private identity and sessions                          | Implemented; CI passed; merged to `main` | PR #13 passed validation, CodeQL, and real-Postgres/API Playwright E2E; promotion PR #14 passed the same required checks. Adds Argon2id owner bootstrap, secure opaque sessions, CSRF/origin checks, login throttling, password rotation, and session revocation. |
| P2-02 Preferences, Manila server date, owner scope           | Implemented; CI pending                  | Theme/privacy preference API, immutable PHP/Asia-Manila policy, server-owned `serverToday`, explicit first-account onboarding state, and fail-closed owner-ID helper. E2E adds preferences, clock-skew, and cross-user checks.                                    |

## Later phases

Phase 1 remains in progress pending physical-device owner review. Phase 2 identity and preferences work are in progress; ledger schema and financial workflows have not started. Phases 3–6 remain unstarted. No launch feature is complete until its full vertical slice and independent QA meet the master plan Definition of Done.

## Environment and validation record

- `npm run typecheck` — passed locally.
- `npm run test:unit` — 5 exact-money cases passed locally.
- `npm run format:check` — passed locally.
- Route, deep-link, back-navigation, no-sample-data, mobile secondary navigation, theme, amount validation, privacy mask, and browser 404 Playwright checks — 13 passed locally across desktop and Pixel 7 emulation; the live PostgreSQL health test remains in required CI.
- Pixel 7 and desktop screenshots were reviewed locally. Real-device checks remain outstanding.
- GitHub Actions `validate`, `CodeQL`, and `e2e` — passed on the foundation feature PR before merge to `dev` and promotion to `main`.
- Real-stack CI — PostgreSQL migration, API readiness, web health, and Playwright smoke suite passed.
- Branch protection — `validate`, `CodeQL`, and `e2e` required on `main` and `dev`; PR-only owner workflow uses zero required approvals.
- Phase 1 promotion PR #12 — all checks passed and merged to `main`.
- Identity slice local validation — TypeScript, production builds, Prettier, and `npm audit --audit-level=high` pass; no high severity vulnerabilities.
- Identity feature PR #13 — validation, CodeQL, and real PostgreSQL/API Playwright E2E passed; merged to `dev`.
- Identity promotion PR #14 — checks passed and merged to `main`.
- P2-02 local validation — typecheck, API and E2E TypeScript checks, builds, five unit tests, format, and audit pass. Real-Postgres E2E is pending in CI.
- Docker/PostgreSQL Compose — not run locally; no Docker executable or other container runtime is installed.

## Next work

1. Review the navigation and visual direction on an actual phone and desktop before closing Phase 1.
2. Complete P2-02 PostgreSQL-backed E2E and merge its reviewed PR.
3. Continue with the financial schema only after the identity and owner-scope helpers are accepted.
