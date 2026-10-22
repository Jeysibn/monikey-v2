# MoniKey V2 architecture audit

Updated: 2026-10-23

This is a source and local-runtime audit against the approved master plan. It records verified implementation boundaries and open release gates. It is not a substitute for independent QA, owner sign-off, or a live homelab review.

## Verified boundaries

| Area                 | Evidence                                                                                                                                                                                                                                                                                                                               | Result |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ledger ownership     | `rg` found the only `INSERT INTO postings` in `apps/api/src/ledger/service.ts`; ADR-001 defines the service boundary.                                                                                                                                                                                                                  | Pass   |
| Exact money          | `packages/money` uses bigint/string values; the amount scan found no `Number`, `parseFloat`, or `parseInt` conversion of money fields. Unit and invariant suites pass.                                                                                                                                                                 | Pass   |
| Owner isolation      | Route handlers derive `ownerUserId` from the authenticated session; module queries constrain `user_id`; Playwright verifies cross-user account and export isolation.                                                                                                                                                                   | Pass   |
| Immutable history    | PostgreSQL trigger/schema checks and transaction integration tests cover append-only journals, postings, revisions, and audit events. Opposite-direction concurrent transfers also serialize with two balanced journals and no balance drift.                                                                                          | Pass   |
| Contract surface     | Runtime OpenAPI and generated declarations contain the plan’s health, account, transaction, card, bill, report, and `/exports/data.json` routes.                                                                                                                                                                                       | Pass   |
| Browser/PWA boundary | The service worker caches only the shell; `/api/` and personal responses remain network-only. Playwright covers offline state and disabled writes.                                                                                                                                                                                     | Pass   |
| Local topology       | Base Compose exposes only web; `compose.local-test.yaml` supplies explicit API/DB mappings for disposable host-driven tests. Both configs render successfully.                                                                                                                                                                         | Pass   |
| Security guardrails  | Secure sessions, CSRF/origin checks, rate limiting, a shared no-store guard for every personal API route family, owner-only exports, secret scanning, and ESLint are implemented. Production web/API images run nonroot; API URLs and proxy query strings are redacted from logs; the web proxy adds CSP and browser security headers. | Pass   |

## Local evidence

- Clean override-backed Docker stack: PostgreSQL, API, and web healthy.
- One-worker Playwright: 24 passed, 8 intentional mobile/desktop skips; the authenticated Quick Add sheet uses an isolated disposable E2E user so the login throttle remains meaningful.
- Root integration alias: ledger, accounts, categories, transactions/dashboard, cards, bills, and reports all passed locally against PostgreSQL.
- One-worker Playwright: 24 passed, 8 intentional mobile/desktop skips; the full authenticated release review passed all 18 route/viewport combinations in light and dark themes with zero axe violations, focus failures, page errors, API errors, overflow, unnamed controls, or undersized controls. Fresh API p95 was 38ms on desktop and 180ms on Pixel 7-sized emulation.
- Migration upgrade: an isolated temporary PostgreSQL database applied the prior V2 schema checkpoint and the cards/bills migration successfully, then verified the final tables before cleanup.
- Backup/restore: custom-format dump validated and restored into an isolated database before cleanup.
- Production image path: API and web images built from digest-pinned bases; production API readiness passed with database connected as `node`; the dedicated migration image applied all five migrations to a fresh disposable database; the nonroot web image served CSP/security headers and passed five targeted Playwright desktop journeys through the production Nginx proxy.

## Open gates

- P0-07 still needs image vulnerability scans, SBOM generation, immutable GHCR image publication/provenance, and release checks.
- P1/P4/P5 still need full keyboard/contrast and screen-reader review, physical-device review, and owner acceptance.
- Production backup scheduling, monitoring, TLS, SOPS/age, migration Job, manifests, cutover, and rollback remain Phase 6 work.
- The authoritative `/home/jeysi/homelab-gitops` checkout and `kubectl`/Argo/Helm/Kustomize tools are unavailable, so no production assumptions were made.

## Audit decision

The local architecture is internally consistent with the approved V2 ledger, ownership, exact-money, API, PWA, and Compose boundaries. Release completion is withheld until the open human and infrastructure gates have authoritative evidence.
