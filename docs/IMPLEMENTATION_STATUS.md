# Implementation status

Updated: 2026-10-22. The phase sequence and acceptance gates below come from `MONIKEY_V2_MASTER_PLAN.md`. A source file existing is not equivalent to a work package passing its acceptance gate.

## Current milestone

**Phase 0 — Foundation and engineering guardrails: implemented; required acceptance checks pass.** Phase 1 design-system and route work is next. No identity or financial product flow is implemented, and no V1 code or data has been imported.

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

## Later phases

Phases 1–6 have not started. They cover UX direction/component system, private identity and ledger, private alpha, card statements and bills, reports/export, and production GitOps cutover. No launch feature is complete until its full vertical slice and independent QA meet the master plan Definition of Done.

## Environment and validation record

- `npm run typecheck` — passed locally.
- `npm run test:unit` — 5 exact-money cases passed locally.
- `npm run format:check` — passed locally.
- GitHub Actions `validate`, `CodeQL`, and `e2e` — passed on the foundation feature PR before merge to `dev` and promotion to `main`.
- Real-stack CI — PostgreSQL migration, API readiness, web health, and Playwright smoke suite passed.
- Branch protection — `validate`, `CodeQL`, and `e2e` required on `main` and `dev`; PR-only owner workflow uses zero required approvals.
- Docker/PostgreSQL Compose — not run locally; no Docker executable or other container runtime is installed.

## Next work

1. Produce the visual token and interaction specification required before backend-connected finance UI.
2. Implement responsive route skeletons, navigation, dialogs/sheets, accessibility states, and theme controls without fake financial behavior.
3. Review identity, ownership, session security, idempotency, and ledger contracts before the first persistent financial schema.
4. Continue in the approved dependency order and update this status after each completed acceptance gate.
