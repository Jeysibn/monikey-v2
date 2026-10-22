# Changelog

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
