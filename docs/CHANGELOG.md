# Changelog

## 2026-10-22 — Phase 5 release review and Phase 6 readiness

- Aligned the public API with the master-plan endpoint contract by adding `/api/v1/health/live`, `/api/v1/health/ready`, and `/api/v1/exports/data.json`; updated the web client, Compose readiness probe, OpenAPI types, and Playwright coverage.
- Aligned Compose with the planned topology: the base stack exposes only the web port, while `compose.local-test.yaml` explicitly adds API/PostgreSQL host mappings for disposable local acceptance.
- Added a repeatable local release review with WCAG 2A/2AA axe checks, responsive overflow and target-size checks, reduced-motion verification, and a report API timing baseline.
- Made the local release review authenticate once and reuse its session across viewport checks so repeated local runs do not consume the sign-in rate-limit budget.
- Extended the local release review with FCP/LCP/CLS, page-error, and API-error measurements, including an initialization-time LCP observer for reliable browser samples.
- Added the tracked-file `npm run security:secrets` guard and the same check to the existing PR validation job; image publication/provenance remains deferred to Phase 6.
- Recorded the local architecture audit covering ledger ownership, exact money, owner isolation, contracts, PWA caching, Compose topology, security guardrails, and remaining release gates.
- Added `npm run contracts:check` to detect drift between the live OpenAPI document and the tracked generated declaration; the existing full-stack PR job runs it after the API starts.
- Added root `test:integration`, `test:contracts`, `test:finance`, and `test:full-stack` aliases so local validation mirrors the master-plan test layers without using GitHub Actions.
- Added the owner/device review checklist for the remaining Phase 1, Phase 4, Phase 5, and recovery sign-off gates.
- Expanded the local Playwright release review to all nine authenticated routes at desktop and Pixel 7-sized viewports, fixing undersized Activity controls, Quick Add mode tabs, dashboard links, and the mobile Settings privacy control before the full 18-combination baseline passed. Added settled dark-theme axe scans; all 36 light/dark route scans pass.
- Added permanent Playwright coverage for Reports, CSV/JSON exports, Security, Categories, and cross-user export/account isolation.
- Recorded the read-only Phase 6 homelab audit and deployment safety boundary; no GitOps, cluster, secret, image-publication, cutover, or V1 resource action was performed.

## 2026-10-22 — Phase 5 reports, exports, and settings administration

- Added owner-scoped monthly reports with ledger-derived income, spending, refunds, net cash flow, and category summaries.
- Added exact-string CSV transaction export with date filters, attachment headers, and spreadsheet formula-injection mitigation.
- Added schema-versioned owner-only JSON export for portable personal data, excluding secrets and restore behavior.
- Added session listing/revocation, password rotation, and category create/archive/restore settings screens.
- Added local PostgreSQL integration and one-worker Playwright route evidence; no GitHub Actions run was started.

## 2026-10-22 — Phase 4 cards and recurring bills

- Added credit-card liability purchases, exact card payments, negative funding confirmation, credit utilization, manual statement snapshots, partial allocations, and audit-safe correction.
- Added monthly recurring bill definitions, deterministic occurrences, February day-31 clamping, fixed/variable payment confirmation, skip actions, and linked ledger expenses.
- Added upcoming/overdue bill visibility to the dashboard without subtracting unpaid reminders from Available Money.
- Added PostgreSQL migrations, integration tests, generated OpenAPI types, mobile-first screens, and local Docker-backed Playwright evidence.
