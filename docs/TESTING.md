# Validation and acceptance

## Local checks

Run `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run format:check`, and `npm audit` from the repository root. Unit tests use Node's test runner through `tsx` and do not require a database.

## PostgreSQL-backed browser acceptance

The browser suite must use the real API and real PostgreSQL; do not replace it with a mock finance adapter.

```sh
npx playwright install chromium
docker compose up --build -d --wait --wait-timeout 180 api web
npm run test:e2e
docker compose down --volumes --remove-orphans
```

Compose starts PostgreSQL, runs all migrations to completion, waits for the API readiness endpoint, then serves the web client. CI creates an isolated test owner through the one-time bootstrap CLI and an explicitly E2E-guarded second user, then executes `prisma/tests/financial_schema.sql` against the migrated PostgreSQL database. That SQL contract suite verifies account and category checks, composite owner references, append-only postings, positive exact amounts, per-owner idempotency uniqueness, and deferred balanced-journal enforcement. API database tests exercise the ledger writer, account opening balances, category lifecycle, expense/income/transfer/refund/adjustment commands, revision commands, and activity query behavior against PostgreSQL, including equity-backed bank/card openings, exact balances, default category seeding, custom category ledger mappings, history retention, audit linkage, balanced journals, category compatibility, negative-balance confirmation, future-date rejection, linked refund limits, deterministic account locks, reversal journals, logical voids, audit revisions, cursor pagination, account filters, date/kind/status/category/search filters, and cross-user denial. Playwright covers desktop and Pixel 7 mobile emulation, honest empty-state content, database readiness, private login, secure cookie attributes, CSRF and origin rejection, profile/session recovery, cross-user isolation, preferences, Manila server date despite a skewed browser clock, account, category, transaction creation/replay/conflict, transfer/refund/adjustment flows, edit/audit/delete flows, ledger-derived balances, rename/archive history, invalid inputs, logout, invalid credentials, and rate limiting. CI installs Chromium system dependencies and runs this Compose-backed suite against real PostgreSQL.

The separate `test` Compose profile exposes an ephemeral PostgreSQL instance for focused integration suites.

## Environment limitations

The implementation environment currently has no Docker/container runtime or local PostgreSQL tools. In this environment, do not claim the Compose-backed browser suite passed. GitHub Actions is the current execution environment for that gate.
