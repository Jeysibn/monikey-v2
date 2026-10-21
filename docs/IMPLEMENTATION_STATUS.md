# Implementation status

Updated: 2026-10-22. The phase sequence and acceptance gates below come from `MONIKEY_V2_MASTER_PLAN.md`. A source file existing is not equivalent to a work package passing its acceptance gate.

## Current milestone

**Phase 0 — Foundation and engineering guardrails: implemented; required acceptance checks pass. Phase 1 — UX direction and component system: in progress.** Design tokens, route behavior, responsive navigation, themes, exact amount-entry validation, disabled record selectors, and a non-financial privacy-mask preview are implemented. Owner review on real devices remains a Phase 1 exit gate. No identity or financial product flow is implemented, and no V1 code or data has been imported.

| Work package                                                 | State                             | Evidence / remaining gate                                                                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-01 New repository and branch policy                       | Implemented                       | Public repository: `https://github.com/Jeysibn/monikey-v2`. Default `main`; `dev` and `main` require PRs and `validate`, `CodeQL`, and `e2e`; conversation resolution is required; force pushes and deletions are disabled. |
| P0-02 npm workspaces                                         | Implemented                       | Lockfile committed; clean-clone `npm ci`, TypeScript validation, and builds pass in GitHub Actions.                                                                                                                         |
| P0-03 Architecture/docs templates                            | Implemented                       | Master plan, `PRODUCT.md`, `AGENTS.md`, architecture context, ADR template and decisions, release and test docs.                                                                                                            |
| P0-04 Compose + Postgres + API + web + migration             | Implemented; CI acceptance passed | Compose runs PostgreSQL 17, Prisma migration, API, and web. Real-stack CI reached service health and applied the baseline migration. Local Compose is unavailable because this environment has no container runtime.        |
| P0-05 Contracts, error shape, OpenAPI, typed client          | Implemented; CI acceptance passed | Shared Zod health/error schemas, Fastify error handling, runtime OpenAPI, generated types, and typed fetch client. Temporary echo route was removed after CodeQL found reflected input.                                     |
| P0-06 Lint/format/typecheck/unit/integration/E2E scaffolding | Implemented; CI acceptance passed | Strict TypeScript, Prettier, exact-money unit tests, Playwright desktop/mobile projects, and required PostgreSQL-backed browser smoke checks. Financial domain DB tests are part of later feature slices.                   |
| P0-07 GitHub Actions and security checks                     | Partial                           | `npm audit`, typecheck, build, unit, format, CodeQL, and real-stack E2E are required. Image publication/provenance and dedicated secret scanning remain.                                                                    |
| P0-08 Obsidian working project                               | Implemented                       | V2 vault area contains the full plan, status, decision log, ADRs, work log, release flow, and V1/V2 boundary link.                                                                                                          |
| P1-01 Design tokens and theme draft                          | Implemented; review pending       | `docs/design/DESIGN_SYSTEM.md` defines blue/navy light/dark tokens, semantic values, type, spacing, focus, and motion. Contrast and owner approval remain.                                                                  |
| P1-02 Route and interaction draft                            | Implemented; review pending       | Design doc covers route, navigation, form and overlay behavior. Real-device/owner review remains.                                                                                                                           |
| P1-03 Responsive shell and theme control                     | Implemented; CI passed            | Desktop rail, four-action mobile navigation, More menu, theme preference, reduced motion and honest preview status.                                                                                                         |
| P1-04 Route skeleton and deep links                          | Implemented; CI passed            | React Router skeletons, deep-link refresh, history navigation, route boundaries and in-shell 404s pass real-stack CI. Authentication awaits Phase 2.                                                                        |
| P1-05 Amount, selectors and privacy mask                     | In progress                       | Exact PHP amount parsing, no-save preview form, disabled empty account/category selectors and accessible mask control. Production records and mutation remain absent.                                                       |
| P1-06 Device screenshots and design acceptance               | Partial                           | 360/Pixel 7 emulation and 1440px desktop preview captures are saved. Physical phone and owner approval remain.                                                                                                              |

## Later phases

Phase 1 is in progress; phases 2–6 have not started. They cover the design system and routes, private identity and ledger, private alpha, card statements and bills, reports/export, and production GitOps cutover. No launch feature is complete until its full vertical slice and independent QA meet the master plan Definition of Done.

## Environment and validation record

- `npm run typecheck` — passed locally.
- `npm run test:unit` — 5 exact-money cases passed locally.
- `npm run format:check` — passed locally.
- Route, deep-link, back-navigation, no-sample-data, mobile secondary navigation, theme, amount validation, privacy mask, and browser 404 Playwright checks — 13 passed locally across desktop and Pixel 7 emulation; the live PostgreSQL health test remains in required CI.
- Pixel 7 and desktop screenshots were reviewed locally. Real-device checks remain outstanding.
- GitHub Actions `validate`, `CodeQL`, and `e2e` — passed on the foundation feature PR before merge to `dev` and promotion to `main`.
- Real-stack CI — PostgreSQL migration, API readiness, web health, and Playwright smoke suite passed.
- Branch protection — `validate`, `CodeQL`, and `e2e` required on `main` and `dev`; PR-only owner workflow uses zero required approvals.
- Docker/PostgreSQL Compose — not run locally; no Docker executable or other container runtime is installed.

## Next work

1. Finish accessible component states, amount-entry/selector primitives, and screenshot breakpoints.
2. Review the navigation and visual direction on actual phone and desktop before closing Phase 1.
3. Review identity, ownership, session security, idempotency, and ledger contracts before the first persistent financial schema.
4. Continue in the approved dependency order and update this status after each completed acceptance gate.
