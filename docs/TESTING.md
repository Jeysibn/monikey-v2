# Validation and acceptance

## Local checks

Run `npm run validate` from the repository root for the static, database-free gate: ESLint, strict TypeScript/builds, exact-money and invariant tests, formatting, the tracked-file secret scan, and the dependency audit. With the local API running, `npm run test:contracts` regenerates the OpenAPI declaration in a temporary directory and compares it with the tracked typed declaration. `security:secrets` scans tracked text files for high-confidence private keys, provider tokens, and credentialed database URLs; inert local/test placeholders are explicitly excluded. `npm run review:local` adds the repeatable full authenticated route baseline for Home, Activity, Quick Add, Accounts, Bills, Settings, Reports, Security, and Categories at desktop and Pixel 7-sized viewports, scanning both light and dark themes with axe and checking keyboard traversal/focus styling. Unit and property tests use Node's test runner through `tsx` and do not require a database. The invariant suite generates random valid journal sequences, checks compensating reversals and edits, verifies transfer fee identities, and exercises exact values above JavaScript's safe integer boundary. Repository guardrail tests verify PostgreSQL suites fail closed when `DATABASE_URL` is missing; `npm run test:integration` runs all PostgreSQL suites sequentially against the host-mapped disposable database.

For local PostgreSQL coverage, start the Compose stack with the disposable test override, bootstrap the disposable owner and disposable E2E users, then run the API suites with the host database URL:

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

The transaction command includes `dashboard.integration.test.ts`, which checks that dashboard totals reconcile after opening balances, income, spending, transfer fees, and an edited expense. It also runs two opposite-direction transfers concurrently against the same two accounts and verifies deterministic lock ordering, two balanced journals, and unchanged balances. The card suite checks liability purchases, payments, statement allocations, and statement correction. The bill suite checks deterministic day-31 February clamping, owner scope, one linked expense payment, variable-bill actual-amount confirmation, and idempotent payment replay. The reports suite checks refund netting, category totals, exact minor-unit exports, and CSV formula-injection mitigation. The standard Playwright suite covers the private owner journey plus Reports, JSON/CSV export headers, Security, and Categories against the same real API and PostgreSQL stack. Its owner/second-user session test verifies guessed-account reads and owner transaction IDs do not cross the JSON or CSV export boundary.

Migration safety was also checked locally in an isolated temporary PostgreSQL database: migrations through `20261022230000_category_icons` were applied as a prior V2 checkpoint, then `20261023000000_cards_bills` was applied successfully and `card_statements`, `bills`, and `bill_occurrences` were verified before the database was dropped. The application database and disposable test volume were not used for this drill.

## PostgreSQL-backed browser acceptance

The browser suite must use the real API and real PostgreSQL; do not replace it with a mock finance adapter. The first-account acceptance path covers login, owner-scoped onboarding, opening-balance persistence, idempotent replay, duplicate prevention, and the READY profile state. The Quick Add path covers authenticated account/category loading, expense creation, exact amount validation, transfer mode, and saved-state feedback. When opened from the authenticated shell it is an accessible contextual sheet with focus trapping, Escape/backdrop close, and an unsaved-entry discard warning; a direct deep link remains a full-page fallback. The signed-out route remains an honest no-save preview. The PWA path covers manifest metadata, shell-only service-worker behavior, an explicit offline state, and disabled transaction submission while offline. Preference acceptance covers persisted dark theme and privacy-default masking after an authenticated profile update; reduced-motion CSS is exercised by the existing accessibility-safe shell styles. The financial browser flow also asserts `Cache-Control: no-store` on authenticated category, card statement, and dashboard responses; the shared API send hook covers every personal route family so a newly added read handler cannot silently become cacheable.

```sh
npx playwright install chromium
docker compose -f compose.yaml -f compose.local-test.yaml up --build -d --wait --wait-timeout 180 api web
docker compose -f compose.yaml -f compose.local-test.yaml exec -T \
  -e MONIKEY_BOOTSTRAP_EMAIL=owner@example.test \
  -e MONIKEY_BOOTSTRAP_PASSWORD=CI-only-password-never-used-outside-tests \
  api npm run bootstrap-owner --workspace @monikey/api
docker compose -f compose.yaml -f compose.local-test.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=second@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-second-user-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api
docker compose -f compose.yaml -f compose.local-test.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=sheet@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-sheet-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api
npx playwright test --workers=1
docker compose -f compose.yaml -f compose.local-test.yaml down --volumes --remove-orphans
```

Compose starts PostgreSQL, runs all migrations to completion, waits for the API readiness endpoint, then serves the web client. Bootstrap the disposable owner and disposable E2E users locally before database-backed tests. The seed command accepts a new email each time, so stateful browser checks can use isolated accounts without exhausting the login throttle. The standard browser fixture expects `owner@example.test`, `second@example.test`, and `sheet@example.test`; CI creates all three with the same restricted seed command. The SQL contract suite verifies account and category checks, composite owner references, append-only postings, positive exact amounts, per-owner idempotency uniqueness, and deferred balanced-journal enforcement. API database tests exercise the ledger writer, account opening balances, category lifecycle, expense/income/transfer/refund/adjustment commands, card liability/payment/statement commands, recurring bill generation/payment, revision commands, and activity query behavior against PostgreSQL, including deterministic day-31 February handling, owner scope, statement allocation limits, and linked bill payments. Playwright covers desktop and Pixel 7 mobile emulation, honest empty-state content, database readiness, private login, secure cookie attributes, CSRF and origin rejection, profile/session recovery, cross-user isolation, preferences, Manila server date despite a skewed browser clock, account, category, transaction creation/replay/conflict, transfer/refund/adjustment flows, card detail/payment and Bills routes, edit/audit/delete flows, ledger-derived balances, rename/archive history, invalid inputs, logout, invalid credentials, and rate limiting. The local release review authenticates once, reuses the session across its desktop and mobile contexts, and therefore remains repeatable under the API's intentional five-attempt login limiter. Routine validation is local and uses one worker because the acceptance fixtures intentionally share a database state; no GitHub Actions run is needed for these checks.

The separate `test` Compose profile exposes an ephemeral PostgreSQL instance for focused integration suites. The checked-in `compose.local-test.yaml` override exposes the normal disposable stack's API and PostgreSQL ports only when local host-driven integration or Playwright tests need them; the base Compose topology exposes only the web port.

## Environment limitations

The local Docker daemon is available after refreshing the shell's `docker` group membership. The Compose-backed suite was run locally against PostgreSQL, the API, and the web container. GitHub Actions remains a repository protection gate for pull requests, while routine feature validation stays local to preserve the action-minute budget.
