# MoniKey V2 architecture audit

Updated: 2026-10-22

This is a source and local-runtime audit against the approved master plan. It records verified implementation boundaries and open release gates. It is not a substitute for independent QA, owner sign-off, or a live homelab review.

## Verified boundaries

| Area                 | Evidence                                                                                                                                                               | Result |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ledger ownership     | `rg` found the only `INSERT INTO postings` in `apps/api/src/ledger/service.ts`; ADR-001 defines the service boundary.                                                  | Pass   |
| Exact money          | `packages/money` uses bigint/string values; the amount scan found no `Number`, `parseFloat`, or `parseInt` conversion of money fields. Unit and invariant suites pass. | Pass   |
| Owner isolation      | Route handlers derive `ownerUserId` from the authenticated session; module queries constrain `user_id`; Playwright verifies cross-user account and export isolation.   | Pass   |
| Immutable history    | PostgreSQL trigger/schema checks and transaction integration tests cover append-only journals, postings, revisions, and audit events.                                  | Pass   |
| Contract surface     | Runtime OpenAPI and generated declarations contain the plan’s health, account, transaction, card, bill, report, and `/exports/data.json` routes.                       | Pass   |
| Browser/PWA boundary | The service worker caches only the shell; `/api/` and personal responses remain network-only. Playwright covers offline state and disabled writes.                     | Pass   |
| Local topology       | Base Compose exposes only web; `compose.local-test.yaml` supplies explicit API/DB mappings for disposable host-driven tests. Both configs render successfully.         | Pass   |
| Security guardrails  | Secure sessions, CSRF/origin checks, rate limiting, no-store personal responses, owner-only exports, and `npm run security:secrets` are implemented.                   | Pass   |

## Local evidence

- Clean override-backed Docker stack: PostgreSQL, API, and web healthy.
- One-worker Playwright: 23 passed, 7 intentional mobile skips.
- Unit: 5 passed; invariants: 3 passed; reports integration: 1 passed.
- Release review: zero axe violations, page errors, API error responses, CLS, overflow, unnamed controls, and undersized controls.
- Backup/restore: custom-format dump validated and restored into an isolated database before cleanup.

## Open gates

- P0-07 still needs immutable image publication/provenance for production.
- P1/P4/P5 still need full keyboard/contrast and screen-reader review, physical-device review, and owner acceptance.
- Production backup scheduling, monitoring, TLS, SOPS/age, migration Job, manifests, cutover, and rollback remain Phase 6 work.
- The authoritative `/home/jeysi/homelab-gitops` checkout and `kubectl`/Argo/Helm/Kustomize tools are unavailable, so no production assumptions were made.

## Audit decision

The local architecture is internally consistent with the approved V2 ledger, ownership, exact-money, API, PWA, and Compose boundaries. Release completion is withheld until the open human and infrastructure gates have authoritative evidence.
