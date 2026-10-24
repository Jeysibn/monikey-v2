# Testing and local validation

Run commands from the repository root. This guide owns repeatable instructions;
[QA records](../qa/README.md) own dated results. The full earlier validation
record is preserved in [Testing history](TESTING.md).

## Static gate

```sh
npm ci
npm run validate
npm run compose:check
```

`validate` runs lint, strict TypeScript/builds, exact-money and invariant tests,
tooling regression tests, formatting, tracked-file/history secret scanning, and
the dependency audit. It does not run PostgreSQL or browser acceptance. PR CI
runs this gate; finance acceptance additionally requires the real stack below.

## Fresh disposable stack

The isolated Compose project uses PostgreSQL 17.6 in tmpfs, API port 13000,
web port 18080, and loopback database port 15432. Its data is disposable.
These commands affect only the named E2E project.

```sh
npm run e2e:stack:down
npm run e2e:stack:up
```

Seed once per fresh stack. Duplicate-user refusal is expected if these commands
are repeated without resetting. The values below are inert test credentials.

```sh
docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e MONIKEY_BOOTSTRAP_EMAIL=owner@example.test \
  -e MONIKEY_BOOTSTRAP_PASSWORD=CI-only-password-never-used-outside-tests \
  api npm run bootstrap-owner --workspace @monikey/api
docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=second@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-second-user-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api
docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=sheet@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-sheet-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api
docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=crash@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-crash-user-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api
while read -r email password; do
  docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
    -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
    -e "MONIKEY_E2E_EMAIL=$email" -e "MONIKEY_E2E_PASSWORD=$password" \
    api npm run seed-e2e-user --workspace @monikey/api </dev/null
done <<'FIXTURES'
account-create-retry@example.test CI-only-account-create-retry-password
accounts-stale@example.test CI-only-accounts-stale-password
bill-window-validation@example.test CI-only-bill-window-validation-password
card-payment-ui@example.test CI-only-card-payment-ui-password
dashboard-refresh@example.test CI-only-dashboard-refresh-password
income-edit-confirm@example.test CI-only-income-edit-confirm-password
manila-date@example.test CI-only-manila-date-password
overdraft-check@example.test CI-only-overdraft-check-password
origin-check@example.test CI-only-password-never-used-outside-tests
quickadd-retry@example.test CI-only-quickadd-retry-password
rate-limit@example.test CI-only-rate-limit-password
reports-snapshot@example.test CI-only-reports-snapshot-password
statement-create-retry@example.test CI-only-statement-create-retry-password
transaction-edit-confirm@example.test CI-only-transaction-edit-confirm-password
unknown-owner@example.test CI-only-unknown-owner-password
FIXTURES
```

## PostgreSQL integration

After the fresh-stack setup and seeding above:

```sh
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:integration
```

The runner executes ledger, accounts, categories, transactions/dashboard,
cards, bills, reports, idempotency, and actual-API process-crash suites.
Some fixtures commit data. Use a fresh stack before repeating the integration
runner or running browser acceptance; do not assume a populated test database
still satisfies baseline balance assertions.

## Browser acceptance

Start and seed a fresh stack as above, install the pinned browser, then run:

```sh
npx playwright install chromium
COMPOSE_FILE=compose.e2e.yaml \
COMPOSE_PROJECT_NAME=monikey-e2e \
PLAYWRIGHT_BASE_URL=http://localhost:18080 \
PLAYWRIGHT_API_BASE_URL=http://localhost:13000 \
  npm run test:full-stack
```

Use one worker for stateful financial fixtures. Compose variables are required
by tests that discover/restart the actual API container. Direct API requests
use `PLAYWRIGHT_API_BASE_URL`; browser navigation and mutation Origin headers
use `PLAYWRIGHT_BASE_URL`. Repeated logins can exhaust the in-memory rate limit;
reset the disposable stack before a clean rerun rather than weakening auth.
Desktop Chromium and Pixel 7 emulation are configured in `playwright.config.ts`.
Project-specific skips are described in each test; emulation is not physical-device
acceptance.

If the pinned browser download is unavailable, record the exact browser version
and temporary executable override used in the QA report. Remove temporary config
and result artifacts before finishing; do not change the production/default
browser configuration to hide a local setup issue.

## API contracts

With the actual E2E API running:

```sh
API_SPEC_URL=http://localhost:13000/openapi.json npm run test:contracts
```

If an intentional API change requires regenerating declarations:

```sh
API_SPEC_URL=http://localhost:13000/openapi.json npm run api:types
```

Review generated changes and rerun contract parity. Do not edit generated types
independently from runtime contracts.

## Migration upgrade

This explicitly opted-in command creates and removes its own randomly named
scratch database on the loopback E2E PostgreSQL instance. It tests the prior
migration chain followed by the latest migration; existing migrations remain
immutable history.

```sh
MIGRATION_TEST_ALLOW_CREATE_DB=1 \
MIGRATION_TEST_DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:migration-upgrade
```

## Kubernetes schema prerequisites

`deploy:check` is a local render/schema check, not a deployment. It requires
`kustomize`, `kubeconform`, and cached cert-manager CRD JSON schemas. Configure
`KUSTOMIZE_BIN` and `KUBECONFORM_BIN` if they are not on PATH. The schema folder
must contain `{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json` files.

```sh
KUBECONFORM_EXTRA_SCHEMA_LOCATION=/path/to/cached/schemas npm run deploy:check
```

A missing executable or schema cache is a blocked check, not a successful
manifest validation. This command does not contact the live cluster.

## Additional review tools

| Purpose                                             | Entry point                                               |
| --------------------------------------------------- | --------------------------------------------------------- |
| Kubernetes templates                                | `npm run deploy:check`                                    |
| Five-width authenticated route/accessibility review | `npm run review:local`                                    |
| 10,000-transaction pagination review                | `npm run test:scale-review`                               |
| Backup and isolated restore                         | [Restore runbook](../runbooks/restore.md)                 |
| Image builds and scanning                           | [Production images](../runbooks/production-images.md)     |
| Financial acceptance cases                          | [Acceptance matrix](../qa/FINANCIAL_ACCEPTANCE_MATRIX.md) |

Tool environment variables and specialized procedures are documented in the
[script index](../../scripts/README.md), applicable runbooks, and QA records.

## Cleanup and evidence

```sh
npm run e2e:stack:down
```

Record source revision/worktree identity, commands actually executed, exact
results/skips, browser/database versions, and limitations in `docs/qa/YYYY-MM-DD/`.
Keep reports with their evidence. Never treat a historical successful command as
proof that the current worktree passed. Device, owner, and live-cluster acceptance
remain separate release gates.
