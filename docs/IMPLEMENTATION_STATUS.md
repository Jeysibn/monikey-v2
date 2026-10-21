# Implementation status

Updated: 2026-10-22. The phase sequence and acceptance gates below come from `MONIKEY_V2_MASTER_PLAN.md`. A source file existing is not equivalent to a work package passing its acceptance gate.

## Current milestone

**Phase 0 — Foundation and engineering guardrails: in progress.** The local workspace compiles and builds. The Compose stack and API/browser acceptance workflow are authored; local Compose execution is unavailable because this environment has no Docker or other container runtime.

| Work package                                                 | State                                   | Evidence / remaining gate                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-01 New repository and branch policy                       | Implemented                             | Public repository: `https://github.com/Jeysibn/monikey-v2`. Default `main`; `dev` and `main` require pull requests, passing `validate` + `CodeQL`, conversation resolution, and disallow force pushes/deletions. |
| P0-02 npm workspaces                                         | Implemented; local build/typecheck pass | Lockfile committed with workspace layout; clean-clone `npm ci` passed in GitHub Actions.                                                                                                                         |
| P0-03 Architecture/docs templates                            | Implemented                             | Master plan, `PRODUCT.md`, `AGENTS.md`, architecture context, ADR template, issue/PR templates.                                                                                                                  |
| P0-04 Compose + Postgres + API + web + migration             | CI acceptance pending                   | Compose includes Postgres, one-shot migration service, API, web, and disposable `test` Postgres profile. The live-stack job will validate it.                                                                    |
| P0-05 Contracts, error shape, OpenAPI, typed client          | Implemented; CI acceptance pending      | Shared Zod health/command/error schemas, standard Fastify errors, OpenAPI JSON, generated `openapi-fetch` client, valid/invalid contract probes.                                                                 |
| P0-06 Lint/format/typecheck/unit/integration/E2E scaffolding | Implemented; CI acceptance pending      | Strict TypeScript, Prettier, exact-money unit tests, Playwright desktop/mobile projects, disposable DB profile, and real-stack e2e workflow. Domain DB integration tests remain for P2.                          |
| P0-07 GitHub Actions and security checks                     | Partial                                 | CI includes npm audit, typecheck, build, unit tests, formatting, CodeQL, and a Postgres/API-backed Playwright job. Image publishing/provenance and dedicated secret scan remain.                                 |
| P0-08 Obsidian working project                               | Implemented                             | V2 vault area contains the full plan, status, decision log, ADRs, work log, and a V1/V2 boundary link.                                                                                                           |

## Later phases

Phases 1–6 have not been started. They cover the design system, identity and ledger, private alpha, card statements and bills, reporting/export, and production GitOps cutover. No launch feature is considered complete until its full vertical slice and independent QA meet the master plan's Definition of Done.

## Environment and validation record

- `npm run typecheck` — passed locally.
- `npm run test:unit` — 5 exact-money cases passed locally.
- `npm run build` — passed locally; Vite emitted the production client bundle.
- `npm run format:check` — passed locally.
- `npm audit` — zero vulnerabilities.
- GitHub Actions `validate` and `CodeQL` — passed on previous PRs; the new `e2e` job has not yet been required or run.
- Branch protection — active on `main` and `dev`; required checks are `validate` and `CodeQL`. Owner-only workflow requires PRs but zero approvals.
- Docker/PostgreSQL Compose — not run locally; no Docker executable or other container runtime is installed.

## Next work

1. Pass the new Compose-backed PostgreSQL/API/Playwright acceptance job in GitHub Actions and require `e2e` on protected branches.
2. Add real PostgreSQL domain integration tests with the first persistent schema.
3. Add image publishing/provenance and a dedicated secret scan before P0-07 is complete.
4. Approve visual system and route flows before building financial screens.
5. Begin P2 identity and ledger after schema, ownership, idempotency, and financial invariants are reviewed.
