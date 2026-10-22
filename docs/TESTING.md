# Validation and acceptance

## Local checks

Run `npm run typecheck`, `npm run test:unit`, `npm run test:invariants`, `npm run build`, `npm run format:check`, and `npm audit` from the repository root. Unit and property tests use Node's test runner through `tsx` and do not require a database. The invariant suite generates random valid journal sequences, checks compensating reversals and edits, verifies transfer fee identities, and exercises exact values above JavaScript's safe integer boundary. Repository guardrail tests verify PostgreSQL suites fail closed when `DATABASE_URL` is missing; integration suites use the shared guard before opening a pool.

For local PostgreSQL coverage, start the Compose stack, bootstrap the disposable owner and second user, then run the API suites with the host database URL:

```sh
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:ledger --workspace @monikey/api
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:accounts --workspace @monikey/api
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:categories --workspace @monikey/api
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:transactions --workspace @monikey/api
```

The transaction command includes `dashboard.integration.test.ts`, which checks that dashboard totals reconcile after opening balances, income, spending, transfer fees, and an edited expense. The authenticated home-screen Playwright path covers the dashboard endpoint, and the private owner journey covers Activity filter reload, detail edit, reversal, and immutable-history feedback.

## PostgreSQL-backed browser acceptance

The browser suite must use the real API and real PostgreSQL; do not replace it with a mock finance adapter. The first-account acceptance path covers login, owner-scoped onboarding, opening-balance persistence, idempotent replay, duplicate prevention, and the READY profile state. The Quick Add path covers authenticated account/category loading, expense creation, exact amount validation, transfer mode, and saved-state feedback while the signed-out route remains an honest no-save preview.

```sh
npx playwright install chromium
docker compose up --build -d --wait --wait-timeout 180 api web
npm run test:e2e
docker compose down --volumes --remove-orphans
```

Compose starts PostgreSQL, runs all migrations to completion, waits for the API readiness endpoint, then serves the web client. CI creates an isolated test owner through the one-time bootstrap CLI and an explicitly E2E-guarded second user, then executes `prisma/tests/financial_schema.sql` against the migrated PostgreSQL database. That SQL contract suite verifies account and category checks, composite owner references, append-only postings, positive exact amounts, per-owner idempotency uniqueness, and deferred balanced-journal enforcement. API database tests exercise the ledger writer, account opening balances, category lifecycle, expense/income/transfer/refund/adjustment commands, revision commands, and activity query behavior against PostgreSQL, including equity-backed bank/card openings, exact balances, default category seeding, custom category ledger mappings, history retention, audit linkage, balanced journals, category compatibility, negative-balance confirmation, future-date rejection, linked refund limits, deterministic account locks, reversal journals, logical voids, audit revisions, cursor pagination, account filters, date/kind/status/category/search filters, and cross-user denial. The separate `test:invariants` check runs alongside validation in CI. Playwright covers desktop and Pixel 7 mobile emulation, honest empty-state content, database readiness, private login, secure cookie attributes, CSRF and origin rejection, profile/session recovery, cross-user isolation, preferences, Manila server date despite a skewed browser clock, account, category, transaction creation/replay/conflict, transfer/refund/adjustment flows, edit/audit/delete flows, ledger-derived balances, rename/archive history, invalid inputs, logout, invalid credentials, and rate limiting. CI installs Chromium system dependencies and runs this Compose-backed suite against real PostgreSQL.

The separate `test` Compose profile exposes an ephemeral PostgreSQL instance for focused integration suites.

## Environment limitations

The local Docker daemon is available after refreshing the shell's `docker` group membership. The Compose-backed suite was run locally against PostgreSQL, the API, and the web container; GitHub Actions remains the required pull-request gate.
