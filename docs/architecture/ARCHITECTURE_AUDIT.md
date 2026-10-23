# MoniKey V2 architecture audit

Updated: 2026-10-23

This is a source and local-runtime audit against the approved master plan. It records verified implementation boundaries and open release gates. It is not a substitute for independent QA, owner sign-off, or a live homelab review.

## Verified boundaries

| Area                     | Evidence                                                                                                                                                                                                                                                                                                                                                  | Result |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ledger ownership         | `rg` found the only `INSERT INTO postings` in `apps/api/src/ledger/service.ts`; ADR-001 defines the service boundary.                                                                                                                                                                                                                                     | Pass   |
| Exact money              | `packages/money` uses bigint/string values; the amount scan found no `Number`, `parseFloat`, or `parseInt` conversion of money fields. Unit and invariant suites pass.                                                                                                                                                                                    | Pass   |
| Owner isolation          | Route handlers derive `ownerUserId` from the authenticated session; module queries constrain `user_id`; Playwright verifies cross-user account read/write/activity, category-name, card payment/statement, bill/occurrence, transaction list/revision/audit, report, and CSV/JSON export isolation. Foreign account activity is empty like an unknown ID. | Pass   |
| Immutable history        | PostgreSQL trigger/schema checks and transaction integration tests cover append-only journals, postings, revisions, and audit events. Opposite-direction concurrent transfers also serialize with two balanced journals and no balance drift.                                                                                                             | Pass   |
| Contract surface         | Runtime OpenAPI and generated declarations contain the plan’s health, account, transaction, card, bill, report, and `/exports/data.json` routes.                                                                                                                                                                                                          | Pass   |
| Transaction traceability | Create/edit/transfer success responses include the current request ID alongside the exact transaction and ledger-derived account result; idempotent replay receives its own request ID. Shared response schemas and generated OpenAPI declarations require the field.                                                                                     | Pass   |
| Browser/PWA boundary     | The service worker caches only the shell; `/api/` and personal responses remain network-only. Playwright covers offline state and disabled writes.                                                                                                                                                                                                        | Pass   |
| Local topology           | Base Compose exposes only web; `compose.local-test.yaml` supplies explicit API/DB mappings for disposable host-driven tests. Both configs render successfully.                                                                                                                                                                                            | Pass   |
| Security guardrails      | Secure sessions, CSRF/origin checks, rate limiting, a shared `private, no-store` guard for every personal API route family, owner-only exports, secret scanning, and ESLint are implemented. Production web/API images run nonroot; API URLs and proxy query strings are redacted from logs; the web proxy adds CSP and browser security headers.         | Pass   |

## Local evidence

- Fresh 2026-10-23 current-worktree acceptance: all nine PostgreSQL integration
  suites passed (18 tests), then the actual API/PostgreSQL Playwright suite
  passed 25 tests with 9 intentional desktop/mobile project skips. It includes
  the streamed owner-scoped export journey and API process-kill rollback path.
  The disposable tmpfs stack was removed and the persistent development API
  returned ready; no Actions run or production change occurred.
- Current-worktree acceptance: `npm run validate` passed locally. A fresh isolated Compose stack rebuilt the API, migrations, and web app against tmpfs PostgreSQL; all nine integration suites passed (18 tests), and one-worker Playwright passed 25 tests with 9 expected project skips across desktop Chromium and Pixel 7 emulation. The stack and database were removed; no Actions run or production change occurred.
- Completed onboarding regression: the authenticated `/onboarding` READY state now links to Accounts and describes the saved journal correctly. Its focused Playwright journey passed against a fresh real API/PostgreSQL stack, and the rendered desktop state was visually inspected.
- Responsive/accessibility review: `npm run review:local` passed for all nine authenticated routes at five widths plus Account Detail and Card Statements at all five widths (55 route/viewport checks and 110 light/dark axe scans), with no reported WCAG 2A/2AA violations, overflow, unnamed or undersized controls, keyboard-focus failures, browser/API errors, or unhandled rejections. Reduced-motion checks passed. This remains browser emulation, not physical-device or screen-reader evidence.
- Phase 6 schema check: temporary Kustomize v5.7.1 rendered the current 24-resource root; strict kubeconform v0.6.7 validation against Kubernetes 1.30.0 and cached cert-manager schemas passed those 24 resources and the separate cutover Ingress (25 total).
- Migration upgrade: a fresh isolated tmpfs PostgreSQL instance applied all five migrations to an empty database. A second database on that instance applied the four-migration previous V2 schema, then the current cards/bills migration; Prisma reported up to date and the card/bill tables were verified before the stack was removed. This verifies fresh and previous-V2 migration paths, not live Argo hook ordering or arbitrary downgrade safety.
- Backup/restore: custom-format dump validated and restored into an isolated database before cleanup.
- Production image path: API and web images built from digest-pinned bases; production API readiness passed with database connected as `node`; the dedicated migration image applied all five migrations to a fresh disposable database; the nonroot web image served CSP/security headers and passed five targeted Playwright desktop journeys through the production Nginx proxy.
- P6-07 observability package is partially implemented: low-cardinality API/DB and journal-invariant metrics passed unit and real PostgreSQL integration checks; twelve alert rules passed Prometheus `promtool` 3.5.0 validation, including a
  unit test proving the journal-invariant alert's quiet/firing behavior. Rule coverage includes failed scheduled and pre-migration backup Jobs using the Kubernetes Job-state metric. Live scrape networking, exporter selectors, Alertmanager, backup/migration telemetry, Loki ingestion, and cluster validation remain open.

## Open gates

- P0-07 PR validation, CodeQL, PostgreSQL/API Playwright commands, secret scanning, and SHA-pinned actions are configured. `npm run check:ci-workflow` and nine guard regressions pass locally; no GitHub Actions run was started for these worktree edits. Local image scans/SBOMs are recorded. GHCR publication, published-digest verification, provenance, and reviewed promotion remain P6-08 gates.
- P1/P4/P5 still need full keyboard/contrast and screen-reader review, physical-device review, and owner acceptance.
- Production backup PVC/Secret wiring and live CronJob validation, monitoring integration, TLS, SOPS/age, migration Job, remaining manifests, cutover, and rollback remain Phase 6 work.
- The read-only `/home/jeysi/homelab-gitops` checkout is clean at `2369afce6161f8c3f3f970cf1e484e44b3227df9`, matching remote `main`. Temporary local Kustomize and kubeconform binaries validated the 24-resource V2 root and separate cutover Ingress against Kubernetes v1.30 and cached cert-manager schemas. `kubectl`, `argocd`, and `helm` are unavailable on PATH and no kubeconfig exists, so live cluster and Argo state remain unverified.

## Audit decision

The local architecture is internally consistent with the approved V2 ledger, ownership, exact-money, API, PWA, and Compose boundaries. Release completion is withheld until the open human and infrastructure gates have authoritative evidence.
