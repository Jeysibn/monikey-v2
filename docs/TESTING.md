# Validation and acceptance

## Local checks

Run `npm run typecheck`, `npm run test:unit`, `npm run test:invariants`, `npm run build`, `npm run format:check`, and `npm audit` from the repository root. `npm run review:local` adds the repeatable desktop/Pixel 7-sized release baseline for Reports, Security, and Categories. Unit and property tests use Node's test runner through `tsx` and do not require a database. The invariant suite generates random valid journal sequences, checks compensating reversals and edits, verifies transfer fee identities, and exercises exact values above JavaScript's safe integer boundary. Repository guardrail tests verify PostgreSQL suites fail closed when `DATABASE_URL` is missing; integration suites use the shared guard before opening a pool.

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
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:cards --workspace @monikey/api
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:bills --workspace @monikey/api
DATABASE_URL='postgresql://monikey:local-only-change-me@localhost:5432/monikey?schema=public' \
  npm run test:reports --workspace @monikey/api
```

The transaction command includes `dashboard.integration.test.ts`, which checks that dashboard totals reconcile after opening balances, income, spending, transfer fees, and an edited expense. The card suite checks liability purchases, payments, statement allocations, and statement correction. The bill suite checks deterministic day-31 February clamping, owner scope, and one linked expense payment. The reports suite checks refund netting, category totals, exact minor-unit exports, and CSV formula-injection mitigation. The standard Playwright suite covers the private owner journey plus Reports, JSON/CSV export headers, Security, and Categories against the same real API and PostgreSQL stack.

## PostgreSQL-backed browser acceptance

The browser suite must use the real API and real PostgreSQL; do not replace it with a mock finance adapter. The first-account acceptance path covers login, owner-scoped onboarding, opening-balance persistence, idempotent replay, duplicate prevention, and the READY profile state. The Quick Add path covers authenticated account/category loading, expense creation, exact amount validation, transfer mode, and saved-state feedback while the signed-out route remains an honest no-save preview. The PWA path covers manifest metadata, shell-only service-worker behavior, an explicit offline state, and disabled transaction submission while offline. Preference acceptance covers persisted dark theme and privacy-default masking after an authenticated profile update; reduced-motion CSS is exercised by the existing accessibility-safe shell styles.

```sh
npx playwright install chromium
docker compose up --build -d --wait --wait-timeout 180 api web
npx playwright test --workers=1
docker compose down --volumes --remove-orphans
```

Compose starts PostgreSQL, runs all migrations to completion, waits for the API readiness endpoint, then serves the web client. Bootstrap the disposable owner and second user locally before database-backed tests. The SQL contract suite verifies account and category checks, composite owner references, append-only postings, positive exact amounts, per-owner idempotency uniqueness, and deferred balanced-journal enforcement. API database tests exercise the ledger writer, account opening balances, category lifecycle, expense/income/transfer/refund/adjustment commands, card liability/payment/statement commands, recurring bill generation/payment, revision commands, and activity query behavior against PostgreSQL, including deterministic day-31 February handling, owner scope, statement allocation limits, and linked bill payments. Playwright covers desktop and Pixel 7 mobile emulation, honest empty-state content, database readiness, private login, secure cookie attributes, CSRF and origin rejection, profile/session recovery, cross-user isolation, preferences, Manila server date despite a skewed browser clock, account, category, transaction creation/replay/conflict, transfer/refund/adjustment flows, card detail/payment and Bills routes, edit/audit/delete flows, ledger-derived balances, rename/archive history, invalid inputs, logout, invalid credentials, and rate limiting. Routine validation is local and uses one worker because the acceptance fixtures intentionally share a database state; no GitHub Actions run is needed for these checks.

The separate `test` Compose profile exposes an ephemeral PostgreSQL instance for focused integration suites.

## Environment limitations

The local Docker daemon is available after refreshing the shell's `docker` group membership. The Compose-backed suite was run locally against PostgreSQL, the API, and the web container. GitHub Actions remains a repository protection gate for pull requests, while routine feature validation stays local to preserve the action-minute budget.
