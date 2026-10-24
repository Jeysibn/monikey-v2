# Validation and acceptance

## Reliability remediation worktree checks — 2026-10-24

- Reviewed `origin/main` at `ff24ae7` and `origin/dev` at `b96900b`; the latter
  is an ancestor of the former. Work is isolated on
  `feature/account-session-date-reliability`, based on `origin/dev`.
- The API already made account creation and opening-balance journals atomic and
  replayable by idempotency key. The confirmed gap was the web flow's fresh key
  for an unresolved retry. Account creation, first-account onboarding, Quick
  Add, and card payments now persist explicit operation IDs and stable API keys
  in bounded `sessionStorage` state. It stores no transaction/account payloads.
  Retries are explicit and enabled only after the user re-enters matching
  details; a new action gets a new key even when its details are identical.
- Session refresh now treats `401` as invalidation and connectivity, timeout,
  API, and CSRF-refresh failures as unavailable. Known profile display can stay
  visible for the same owner, but CSRF is cleared and writes are blocked. Login
  changes clear owner data before network requests. A `BroadcastChannel`
  invalidates/revalidates profile state across tabs, route content is keyed by
  authenticated owner, and account detail/card statement requests ignore stale
  completions.
- Manila date refresh remains server-authoritative through `/me`. Quick Add,
  card payment, and Bills update only untouched form dates; text/input edits no
  longer cause an overnight date rollover. Quick Add reference loading is
  ordered, retriable, and invalidated on owner changes. Account detail and card
  statement loads are likewise request-sequenced.
- Focused regression coverage checks stable identity versus identical new
  transactions, mismatched saved retries, Manila midnight/year rollover,
  account creation with opening balance after a committed lost response,
  session-network recovery and tab-to-tab owner switching, Dashboard/Accounts
  refresh races, card payment replay, and Reports month retries.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`,
  `npm run test:invariants`, and `npm run test:web:unit` passed. The web unit
  suite currently covers Manila dates and pending-submission identity semantics.
- Against a fresh, isolated tmpfs PostgreSQL/API/web Compose stack,
  `npm run test:integration` passed all nine API suites (19 tests), including
  the actual-API process-kill transfer rollback. The one-worker full-stack
  Playwright run passed 35 tests with 19 intentional mobile-project skips
  across desktop Chromium and Pixel 7 mobile emulation. Added browser coverage
  includes account creation/opening-balance replay after a lost response,
  cross-tab owner switching, recovery of multiple pending Quick Add actions,
  starting an identical legitimate purchase while a previous action remains
  unresolved and replaying that first action, card payment replay, and
  deterministic Manila date refresh. The recovery list refreshes after
  uncertain results, success, and terminal rejection so retry/new-action
  controls stay current without a page reload.
- Independent QA reviewed the final session/account replay and pending-list
  changes after integration; no remaining concrete concern was reported.
- `npm run review:local` passed the authenticated route checks across 360,
  390, 768, 1440, and 1920 CSS-pixel widths, light and dark themes, keyboard
  traversal, reduced motion, and WCAG axe scans. The final run inspected 55
  route/viewport combinations with zero horizontal overflow, unnamed controls,
  undersized targets, or axe violations. Home action targets were raised to
  44px, and on mobile account/bill panels now precede recent activity. Screenshots
  are stored in `docs/assets/account-session-date-reliability/` and the mobile
  and desktop Home captures were visually inspected. The Impeccable static scan
  reported no primary findings in the edited TSX/CSS files; its generic live
  URL scan ran unauthenticated and is not treated as app-screen evidence.
- `npm run deploy:check` remains unverified against the local cluster because
  cert-manager CRD schemas were unavailable in the local schema cache. This is
  not evidence of a live-cluster failure; no cluster was contacted or changed.
- No GitHub Actions workflow, production cluster, live GitOps repository,
  persistent development database, or V1 resource was modified.

## Full current-worktree financial and browser acceptance — 2026-10-23

- Rebuilt the isolated `monikey-e2e` stack from this worktree. Its database uses
  tmpfs, with API/web on loopback ports 13000/18080; persistent development
  services were not stopped or written to. The disposable PostgreSQL service uses
  trust authentication only on its isolated Docker network, and the host database
  port is loopback-bound. The four documented disposable users were bootstrapped.
- `npm run test:integration` passed all nine PostgreSQL suites and 18 tests.
  This includes current export paging/formula-safety coverage, owner isolation,
  concurrent idempotency, and killing the actual API during a transfer to verify
  transaction rollback.
- `PLAYWRIGHT_BASE_URL=http://localhost:18080
PLAYWRIGHT_API_BASE_URL=http://localhost:13000 npm run test:full-stack`
  passed 25 tests with 9 intentional project skips across desktop Chromium and
  Pixel 7 emulation. The owner-scoped reports/export/security journey passed
  against the actual API and PostgreSQL.
- The crash-recovery Playwright case invokes Docker itself. Its first attempt
  outside the `docker` group stopped at that local socket permission boundary;
  the clean-stack rerun under `newgrp docker` passed the full suite.
- Removed the isolated Compose project and tmpfs database afterward. The
  persistent development API readiness endpoint returned connected. No Actions
  run, image publication, GitOps change, or deployment occurred.
- A fresh rerun of `npm run validate` passed workflow checks, lint, typecheck,
  production build, finance/invariant tests, local bootstrap/release/migration
  guards, formatting, secret scan and regression tests, and `npm audit` (zero
  vulnerabilities). No GitHub Actions minutes were used.

## CI workflow guard — 2026-10-23

- `npm run check:ci-workflow` parses `.github/workflows/ci.yml` and verifies
  the workflow has one PR validation trigger for `dev`/`main`, a manual boolean
  image-publish input defaulting to false, and only read-only global permissions.
- It also checks that the publisher requires workflow dispatch on `main` plus
  explicit opt-in, has only the required `packages: write` permission, and
  verifies the main merge before building, scanning local images, and publishing.
- `npm run test:ci-workflow` covers malformed YAML, duplicate push trigger,
  wrong publish branch, excess publisher permission, and release ordering. The
  PR workflow uses one `validate` job with secret scanning, `npm run validate`,
  and no Docker or Playwright setup. Financial PostgreSQL integration and
  Playwright remain local pre-merge acceptance checks and must use the actual
  API and PostgreSQL as documented above. These structural guards run as part of
  `npm run validate`; they do not emulate GitHub's workflow runtime or authorize
  image publication. No Actions run was started.

## Reduced GitHub Actions workflow — 2026-10-23

- Simplified `.github/workflows/ci.yml` to a single PR `validate` job. It retains
  TruffleHog commit scanning and the repository's full static/unit/security
  validation, while removing per-PR CodeQL and Docker/PostgreSQL/Playwright
  jobs to conserve the Actions allowance.
- The required PR check is `validate`. Run the real PostgreSQL integration
  suite and one-worker Playwright acceptance locally before merging finance or
  API changes; the isolated Compose instructions above use the actual API and
  PostgreSQL. Image publication remains a separate explicit manual dispatch
  from `main`.
- Updated the release verifier so image publication requires the successful
  `validate` check on the exact merged PR head. The updated workflow passed GitHub Actions run
  [39886879477](https://github.com/Jeysibn/monikey-v2/actions/runs/39886879477)
  on commit `863d29f`; no image publication was started.

## Owner-scoped CSV and JSON streaming — 2026-10-23

- The master plan's export module contract calls for CSV/JSON streaming. Both
  authenticated endpoints now emit transaction rows in keyset pages of 500,
  ordered by `(occurred_on, id)`, inside one repeatable-read, read-only
  transaction. This avoids holding the entire transaction export in an array
  or string while keeping the result snapshot consistent during download.
- CSV chunks preserve quoting, formula-leading-cell protection, exact decimal
  minor-unit strings, no-store headers, and the existing attachment name. JSON
  retains its versioned owner/account/category/bill/card-statement shape and
  streams the transactions array as valid JSON; money values remain strings.
  Disconnect/error cleanup rolls back the snapshot and releases the DB client.
- `reports.integration.test.ts` passed against tmpfs PostgreSQL with a page
  size of one, same-date rows, ordered/no-duplicate IDs, CSV formula safety,
  and JSON parse/exact-string checks. The targeted actual-API Playwright export
  journey passed against the isolated PostgreSQL/API/web stack. `npm run
typecheck` and `npm run lint` passed. No Actions run was started.
- A slow download holds one database connection and repeatable-read snapshot
  until completion or disconnect; production pool sizing and download
  timeouts should account for that per-request resource use.

## Repeatable Kubernetes manifest schema gate — 2026-10-23

- Added `npm run deploy:check` for local Phase 6 manifest validation. It builds
  `deploy/kubernetes`, then runs strict kubeconform validation against
  Kubernetes 1.30 for the rendered root and the separate cutover Ingress.
- Provide Kustomize 5.7.1 and kubeconform 0.6.7 via `KUSTOMIZE_BIN` and
  `KUBECONFORM_BIN`. `KUBECONFORM_EXTRA_SCHEMA_LOCATION` must point to a local
  schema directory containing `cert-manager.io/certificate_v1.json` and
  `cert-manager.io/issuer_v1.json`; native Kubernetes schemas use kubeconform's
  default registry. Example:

  ```sh
  KUSTOMIZE_BIN=/path/to/kustomize \
  KUBECONFORM_BIN=/path/to/kubeconform \
  KUBECONFORM_EXTRA_SCHEMA_LOCATION=/path/to/schemas \
    npm run deploy:check
  ```

- The current run rendered 24 root resources and validated those plus the
  separate cutover Ingress: 25 valid, zero invalid, zero schema errors. This is
  a repeatable local schema gate; it does not check a live cluster, storage,
  secrets, image publication, or Argo behavior.

## PWA install icon acceptance — 2026-10-23

- Added generated 180px Apple touch, 192px, and 512px PNG variants from the
  existing SVG brand icon. `npm run pwa:icons` regenerates all three; the
  manifest declares the Chromium-sized 192px/512px `any maskable` icons, while
  HTML links the 180px Apple touch icon. The service worker caches these static
  icons with the existing shell assets.
- Strengthened the real-browser PWA journey to check manifest entries, the
  Apple touch link, image/png responses, PNG signatures, exact dimensions, and
  absence of `/api/` URLs in service-worker caches. Targeted Playwright passed
  first against the actual development web/API stack, then against the
  production Nginx web image connected to the actual API and tmpfs PostgreSQL.
  Both isolated stacks were removed. `npm run validate` also passed. Actual
  device installation and OS-level icon review remain owner/device gates.
- Chromium installability guidance calls for 192px and 512px icons:
  [Chrome installable manifest requirements](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest).

## SOPS secret generator guard tests — 2026-10-23

- Added four process-level tests around `scripts/create-gitops-secrets.mjs`.
  A fake SOPS executable verifies that the generator supplies mode-0600
  plaintext in its private temp directory, emits only ciphertext output, and
  removes the plaintext on both success and failure. Child-process stderr is
  suppressed on failure; the generator reports only the SOPS exit status.
- Tests also prove child stderr containing a sentinel is not surfaced, malformed
  recipients are rejected before SOPS runs, and
  existing output is never overwritten. No age key, real password, or live
  secret was created; actual encryption remains covered by the earlier
  disposable-key round trip.

## Backup Job failure alert coverage — 2026-10-23

- Added `MoniKeyBackupJobFailed` over Kubernetes Job-state metrics, covering
  both the pre-migration hook and scheduled CronJob Job names. This catches a
  lock-contention failure even if another concurrent backup later publishes
  successful file metrics.
- Prometheus 3.5.0 `promtool check rules` accepted all 12 rules. Rule tests
  verified the alert stays quiet before its one-minute pending interval and
  then fires for both Job name patterns with the expected labels/annotations.
- No live `kube-state-metrics` target or Alertmanager routing was available;
  this validates rule behavior only.

## Pre-migration backup hook and release renderer — 2026-10-23

- Kustomize rendered the updated 24-resource root with the pre-migration backup
  hook. Kubeconform strict validation accepted all 24 Kubernetes 1.30/cert-manager
  resources and the separately rendered cutover Ingress.
- The backup image succeeded against isolated E2E PostgreSQL under UID 70,
  read-only root, no capabilities, and no-new-privileges; a wrong-password run
  exited nonzero. The release renderer now checks seven workload image
  references across six pinned image identities.
- No Argo cluster was available, and no GitHub Actions run was started.

## Shared-volume backup concurrency — 2026-10-23

- Added a nonblocking `flock` on the backup PVC before reading `.state` or
  writing metrics, archive snapshots, or retention changes. The derived image
  build now verifies `flock` exists in its pinned PostgreSQL base.
- In a disposable container run, a second invocation against a held lock
  exited 75 with `stage=already_running`; after forcibly removing the holder,
  a restricted real PostgreSQL backup succeeded. The isolated volume was
  removed. No production PVC or GitHub Actions was used.

## Current Phase 6 manifest and source recheck — 2026-10-23

- The clean read-only homelab GitOps checkout and public remote `main` both
  resolved to `2369afce6161f8c3f3f970cf1e484e44b3227df9`.
- Temporary Kustomize v5.7.1 rendered 24 root resources; kubeconform v0.6.7
  strictly validated all 24 against Kubernetes 1.30 and cached cert-manager
  schemas. The separate cutover Ingress also validated. No kubeconfig,
  `kubectl`, Argo CD CLI, or Helm CLI was available; no cluster was contacted.

## Current-worktree PostgreSQL and browser run — 2026-10-23

- `npm run validate` passed locally: lint, workspace type checks, production builds, 5 exact-money tests, 10 API unit/guardrail/metrics tests, 3 finance property tests, 3 backup-metrics tests, 3 release-verifier tests, formatting, secret/history scanning (129 tracked files and 1,066 reachable Git objects), 3 secret-scan regressions, and `npm audit` with zero vulnerabilities.
- Rebuilt the isolated tmpfs Compose stack from the current worktree. With a dedicated `crash@example.test` integration fixture, all 9 PostgreSQL suites passed (18 tests), then Playwright passed 25 cases with 9 expected project skips across desktop Chromium and Pixel 7 emulation on the same database.
- The first combined run exposed that FIN-019's archived accounts polluted the E2E account-history fixture when both suites shared `second@example.test`. The crash test now uses its own disposable account, and CI plus local setup create that account. The exact CI order (PostgreSQL integration, then Playwright) now passes on one fresh database.
- Removed only the `monikey-e2e` project and its tmpfs database. The development API, web, and PostgreSQL containers remained healthy. No GitHub Actions run, image publication, GitOps edit, or cluster action occurred.

## Local validation refresh — 2026-10-23

- `npm run validate` completed locally: ESLint, strict workspace type checks,
  production builds, five exact-money tests, eight API unit/guardrail/metrics
  tests, three finance invariant tests, Prettier, secret scanning of 129 tracked
  files and 1,066 reachable Git objects, three secret-scanner regression tests,
  and `npm audit` with zero vulnerabilities.
- `npm run compose:check` passed for the base/local-test Compose configuration
  and isolated E2E stack. No Docker services were started by this check, and no
  GitHub Actions run was used.
- The V2 NetworkPolicy Kustomize package rendered seven resources with
  Kustomize v5.7.1; kubeconform v0.6.7 accepted all seven against Kubernetes
  v1.30. A Node/YAML semantic check confirmed the default-deny selectors,
  TCP/UDP DNS egress, and expected application ports/peer selectors. This does
  not verify Calico enforcement or live namespace/workload labels.
- The migration image was rebuilt and run twice against fresh disposable
  PostgreSQL 17.11 with UID 1000, read-only root, `/tmp` tmpfs, no-new-privileges,
  and no capabilities. Five migrations applied on the first run; the second
  found none pending and the ledger remained at five. Argo sync ordering and
  failure behavior were not live-tested.
- Trivy 0.76.0 found zero HIGH/CRITICAL issues in the rebuilt local migration
  image. Syft 1.33.0 generated an SPDX 2.3 SBOM with 160 packages. The
  published GHCR digest still needs its own scan and retained SBOM.
- Trivy 0.76.0 scanned the current local API, web, migration, and backup images
  for all HIGH/CRITICAL findings, including unfixed issues; each returned zero.
- `scripts/verify-release-main.mjs` queried GitHub read-only and verified current
  `main` merge `bf11edfea342adef253ce6ccd21a98aec95e3790` maps to PR #57, whose
  `validate`, `e2e`, and `CodeQL` checks all succeeded on head
  `11f1a009dd5ab6811d5f62e5268c6bfc2b1a9dbc`. `actionlint` 1.7.7 and Prettier
  passed for the workflow and guard. No workflow dispatch or image publication
  was performed.
- The manual release job writes the published digest map, per-digest Trivy JSON
  scan reports, and per-image SPDX SBOMs into one 90-day workflow artifact.
- `npm run test:release-manifest` covers the local release digest-map guard;
  it accepts a complete six-image manifest with the current Prisma migration
  version and rejects missing/duplicate entries, mutable tags, wrong
  repositories, malformed digests, mismatched source commits or schema
  versions, and PR metadata that differs from the earlier release verifier.
  Schema-version helper tests cover latest-migration selection, missing
  migrations, and non-PostgreSQL providers. The publication workflow runs the
  guard after successful image scanning/SBOM generation and before artifact
  retention. `npm run render:release-manifests` validates a retained release
  artifact, injects its six digest pins into a temporary copy of the root
  Kustomize package, verifies there are exactly six expected image references,
  and writes the rendered candidate with exclusive-create semantics. It refuses
  to render unless `HEAD` equals the release source commit and the worktree is
  clean, and blocks output paths inside any Git checkout, including symlinked
  paths. A local synthetic clean Git source rendered six pins across 23 schema-valid
  resources. Choose an output path outside the GitOps checkout.

## Local checks

Run `npm run validate` from the repository root for the static, database-free gate: ESLint, strict TypeScript/builds, exact-money and invariant tests, formatting, the high-confidence secret scan and its regression suite, and the dependency audit. `npm run test:secret-scan` verifies removed historical and uncommitted tokens fail without printing their values, while inert local DB placeholders remain allowed. The existing PR `validate` job also runs the pinned TruffleHog action over the PR commit range. TruffleHog 3.99.4 was additionally run locally on the current branch range from merge base `11f1a009` to `HEAD`; it scanned 619 chunks and reported zero verified or unverified findings. The GitHub Actions check itself remains unrun for this worktree. Run `npm run compose:check` with Docker available to validate the base Compose file, local-test override, and isolated E2E stack before starting services. With the local API running, `npm run test:contracts` regenerates the OpenAPI declaration in a temporary directory and compares it with the tracked typed declaration. `security:secrets` scans tracked text files in the worktree and reachable Git object history for high-confidence private keys, provider tokens, and credentialed database URLs; inert local/test placeholders are explicitly excluded. The PR validation checkout fetches full history so the local scan can inspect reachable prior commits. `npm run review:local` adds the repeatable full authenticated route baseline for Home, Activity, Quick Add, Accounts, Bills, Settings, Reports, Security, and Categories at 360px, 390px, 768px, 1440px, and 1920px, scanning both light and dark themes with axe and checking keyboard traversal/focus styling. Unit and property tests use Node's test runner through `tsx` and do not require a database. The invariant suite generates random valid journal sequences, checks compensating reversals and edits, verifies transfer fee identities, and exercises exact values above JavaScript's safe integer boundary. Repository guardrail tests verify PostgreSQL suites fail closed when `DATABASE_URL` is missing; `npm run test:integration` runs all PostgreSQL suites sequentially against the host-mapped disposable database.

For local PostgreSQL coverage, start the isolated E2E stack and bootstrap the disposable owner and E2E users using the commands in the browser acceptance section. Then run the API suites against its loopback-only host database port. The tmpfs database is shared by the API and browser checks; start with a fresh stack before another stateful suite if its fixtures require pristine data.

`npm run test:integration` is the canonical database suite for every PostgreSQL-backed API test: ledger, accounts, categories, transactions/dashboard, cards, bills, and reports, sequentially against `DATABASE_URL`. The Actions real-stack job runs the separate financial schema constraint script after migration/bootstrap, then invokes this same complete integration runner once. The local command below uses the isolated loopback database.

```sh
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:ledger --workspace @monikey/api
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:accounts --workspace @monikey/api
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:categories --workspace @monikey/api
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:transactions --workspace @monikey/api
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:cards --workspace @monikey/api
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:bills --workspace @monikey/api
DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:reports --workspace @monikey/api
```

The transaction command includes `dashboard.integration.test.ts`, which checks that dashboard totals reconcile after opening balances, income, spending, transfer fees, and an edited expense. It also runs two opposite-direction transfers concurrently against the same two accounts and verifies deterministic lock ordering, two balanced journals, and unchanged balances. The card suite checks liability purchases, payments, statement allocations, and statement correction. The bill suite checks deterministic day-31 February clamping, owner scope, one linked expense payment, variable-bill actual-amount confirmation, and idempotent payment replay. The reports suite checks refund netting, category totals, exact minor-unit exports, and CSV formula-injection mitigation. The standard Playwright suite covers the private owner journey plus Reports, JSON/CSV export headers, Security, and Categories against the same real API and PostgreSQL stack. Its owner/second-user session test verifies guessed-account reads and owner transaction IDs do not cross the JSON or CSV export boundary.

Migration safety is checked against both empty and previous-V2 databases. The current migration chain is applied to the empty tmpfs database during E2E stack startup. Use `npm run test:migration-upgrade` to create a randomly named scratch database on the local E2E PostgreSQL instance, apply every migration except the latest, then apply the full current chain and verify its final migration ledger and card/bill tables. The script drops only its own scratch database even if verification fails. It refuses non-loopback hosts and any admin URL whose database name is not exactly `monikey_e2e`; an explicit opt-in environment variable is also required.

```sh
npm run e2e:stack:up
MIGRATION_TEST_ALLOW_CREATE_DB=1 \
MIGRATION_TEST_DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:migration-upgrade
npm run e2e:stack:down
```

Run Docker commands inside `newgrp docker -c '...'` if the active shell lacks the configured Docker supplementary group. The command creates/drops a database, so do not point it at any database except the dedicated disposable E2E service. Its URL guard and regression tests run as part of `npm run validate`; the database upgrade command itself remains an explicit local acceptance step and does not consume GitHub Actions minutes.

## PostgreSQL-backed browser acceptance

For a full browser run without interrupting the regular development stack, use
the isolated `compose.e2e.yaml` project. It builds the API and web from the
current worktree, creates a fresh tmpfs PostgreSQL database, and binds the
browser app/API to ports 18080/13000. The database is not persisted and the
existing development services are not stopped.

```sh
npx playwright install chromium
npm run e2e:stack:up
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
for spec in \
  accounts-stale:CI-only-accounts-stale-password \
  quickadd-retry:CI-only-quickadd-retry-password \
  card-payment-ui:CI-only-card-payment-ui-password \
  dashboard-refresh:CI-only-dashboard-refresh-password \
  manila-date:CI-only-manila-date-password \
  reports-snapshot:CI-only-reports-snapshot-password \
  session-recovery:CI-only-session-recovery-password \
  owner-isolation:CI-only-owner-isolation-password
do
  email=${spec%%:*}
  password=${spec#*:}
  docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
    -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
    -e MONIKEY_E2E_EMAIL="$email@example.test" \
    -e MONIKEY_E2E_PASSWORD="$password" \
    api npm run seed-e2e-user --workspace @monikey/api || exit 1
done
COMPOSE_FILE=compose.e2e.yaml \
COMPOSE_PROJECT_NAME=monikey-e2e \
PLAYWRIGHT_BASE_URL=http://localhost:18080 \
PLAYWRIGHT_API_BASE_URL=http://localhost:13000 \
  npm run test:full-stack
npm run e2e:stack:down
```

The Playwright origins can be overridden independently for other local
topologies. Direct API requests use `PLAYWRIGHT_API_BASE_URL`; browser
navigation and Origin headers use `PLAYWRIGHT_BASE_URL`. Both default to the
development ports 3000 and 5173. The project stack uses one worker because the
acceptance fixtures share one database. If the suite exits early, run
`npm run e2e:stack:down` to remove its disposable database.

The `crash@example.test` account is reserved for the FIN-019 process-crash
integration test. Its archived account fixtures remain isolated from the E2E
owner and second user, so the canonical CI order (PostgreSQL integration suite,
then Playwright) can share the same fresh database safely.

The expense idempotency journey restarts the API container after the first
committed request, waits for readiness, and replays the same key. For the
isolated local stack, export `COMPOSE_FILE=compose.e2e.yaml` and
`COMPOSE_PROJECT_NAME=monikey-e2e` for the Playwright process so its Docker
restart targets only the disposable E2E API. The CI job already supplies its
own test Compose file through `COMPOSE_FILE`.

The browser suite must use the real API and real PostgreSQL; do not replace it with a mock finance adapter. The first-account acceptance path covers login, owner-scoped onboarding, opening-balance persistence, idempotent replay, duplicate prevention, and the READY profile state. The Quick Add path covers authenticated account/category loading, expense creation, exact amount validation, transfer mode, and saved-state feedback. When opened from the authenticated shell it is an accessible contextual sheet with focus trapping, Escape/backdrop close, and an unsaved-entry discard warning; a direct deep link remains a full-page fallback. The signed-out route remains an honest no-save preview. The PWA path covers manifest metadata, shell-only service-worker behavior, an explicit offline state, and disabled transaction submission while offline. Preference acceptance covers persisted dark theme and privacy-default masking after an authenticated profile update; reduced-motion CSS is exercised by the existing accessibility-safe shell styles. The financial browser flow also asserts `Cache-Control: no-store` on authenticated category, card statement, and dashboard responses; the shared API send hook covers every personal route family so a newly added read handler cannot silently become cacheable.

Transaction create, transfer, and edit success responses include the current request's `requestId`, server-authoritative account balance(s), transaction ID, revision, and effective date. The real-API Playwright expense/transfer journey verifies these identifiers and checks that an idempotent replay returns the original transaction with a new request ID. The OpenAPI contract test checks the response schema against the live local API.

### Full local financial acceptance — 2026-10-23

After the request-ID contract update, a fresh isolated tmpfs Docker stack passed all 15 PostgreSQL integration tests (ledger, account, category, transaction/dashboard, card, bill, and report suites). `npm run test:full-stack` passed 24 desktop/mobile Playwright cases with 8 intentional project-specific skips, including login/CSRF/session flows, account and category ownership, expense/income/transfer/refund/adjustment/edit/reversal, request IDs and idempotent replay, reports/exports, and rate limits. The first attempt used a nonstandard disposable owner password and failed the two owner-auth tests; recreating the stack with the documented fixture credential resolved it, and the final fresh run passed. The tmpfs project was removed. No Actions run was started.

### Idempotency across API restart — 2026-10-23

The transaction Playwright journey now restarts the API container after the
first committed expense, waits for `/health/ready`, then submits two concurrent
retries with the same request and idempotency key. It verifies both responses
resolve to the original transaction ID, each has a fresh per-request ID, and
the account's ledger balance remains unchanged. The focused desktop journey
passed on a fresh tmpfs database; the stack was removed. No GitHub Actions run
was started.

Fresh full-suite rerun against the current worktree on 2026-10-23: 24 passed,
8 expected project skips across desktop Chromium and Pixel 7 emulation. This
includes the API restart and concurrent replay path. The stack was built from
the worktree, used tmpfs PostgreSQL, and was removed after the run; the
development services were not used. No Actions run was started.

The PostgreSQL idempotency integration suite also runs two concurrent
transactions through the idempotency helper, asserts the command executes once,
then verifies committed replay and payload-mismatch rejection. It deletes its
test idempotency row during cleanup. The full eight-suite integration runner
passed twice against the same tmpfs database (17 tests per run), confirming the
fixture leaves no financial rows or other persistent state behind. The
transaction suite also injects a PostgreSQL exception on the second transfer
posting after the first leg has been inserted. Rolling back to the savepoint
removes the transaction, revision, journal, first posting, and audit events;
the reserved idempotency key is removed too, and both account balances remain
unchanged. An initial version of the idempotency test used persistent
account/expense fixtures and caused later dashboard and cursor tests to fail;
that fixture was replaced with cleanup-safe helper-level coverage before the
passing repeat runs.

### Actual API process crash during transfer — 2026-10-23

- Added `apps/api/src/transfer-crash.integration.test.ts` to exercise FIN-019
  with the real API process and PostgreSQL. A PostgreSQL advisory lock pauses
  the transfer during a posting insert; the test sends SIGKILL to the API,
  releases the lock, and verifies PostgreSQL rolled back the transaction,
  journal, postings, and idempotency reservation while both account balances
  remain at their opening amounts.
- The shared integration runner now has nine suites. All 18 tests passed on a
  fresh tmpfs E2E database. The crash suite runs last because its disposable
  funded accounts remain in the database until the E2E project is removed. The
  E2E project was removed after the run; no Actions run was started.

### Journal-invariant monitoring signal — 2026-10-23

- Added the label-free `monikey_ledger_invariant_failures_total` counter. The
  ledger service increments it when debit/credit shape validation rejects an
  unbalanced journal; the transaction boundary also detects PostgreSQL's
  deferred journal-balance constraint error without recording the journal ID.
- Added the critical `MoniKeyLedgerInvariantFailure` rule for any increase in
  the last ten minutes. Unit tests cover both detection boundaries, exclusion
  of unrelated check violations, and exposition without labels.
- The API and alert package remain local-only evidence until scrape reachability
  and Alertmanager routing are validated in the live homelab.

### Local 10,000-transaction pagination review

Use this separate scale review when changing Activity queries or rendering. It is excluded from the routine Playwright suite because it creates 10,000 real ledger entries and requires a disposable owner plus a second user for isolation checks. The seed command is guarded by test mode, explicit opt-in, the exact `monikey_e2e` database name, and a Compose/local-loopback host; transaction/revision fixture rows are inserted directly for speed, while every journal and posting is written through the production `postBalancedJournal` service. Run it only against a fresh tmpfs E2E stack, then remove that stack.

```sh
npm run e2e:stack:up
newgrp docker -c 'docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e MONIKEY_BOOTSTRAP_EMAIL=scale@example.test \
  -e MONIKEY_BOOTSTRAP_PASSWORD=Local-only-password-never-reused \
  api npm run bootstrap-owner --workspace @monikey/api'
newgrp docker -c 'docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_SCALE_SEED=true \
  -e MONIKEY_SCALE_EMAIL=scale@example.test \
  api npm run seed-scale-review --workspace @monikey/api'
newgrp docker -c 'docker compose -p monikey-e2e -f compose.e2e.yaml exec -T \
  -e NODE_ENV=test -e ALLOW_E2E_USER_SEED=true \
  -e MONIKEY_E2E_EMAIL=scale-secondary@example.test \
  -e MONIKEY_E2E_PASSWORD=CI-only-scale-secondary-password-never-used \
  api npm run seed-e2e-user --workspace @monikey/api'
PLAYWRIGHT_BASE_URL=http://localhost:18080 \
PLAYWRIGHT_API_BASE_URL=http://localhost:13000 \
MONIKEY_SCALE_EMAIL=scale@example.test \
MONIKEY_SCALE_PASSWORD=Local-only-password-never-reused \
  npm run test:scale-review
npm run e2e:stack:down
```

The review signs in to the actual API, retrieves every cursor page with a maximum of 100 rows, asserts 10,000 unique transaction IDs, checks the ledger-derived source-account balance, opens the real Activity route, and verifies incremental rendering from 25 to 50 rows. It then signs in as a second disposable user and confirms that the 10,000 entries and scale account are not visible. It reports first-user API page latency. Earlier runs returned 10,000 unique entries in 100 pages in 3,953–4,343 ms total (16–23 ms page p95); the first-page owner-activity index plan returned 101 rows in 0.54–0.94 ms. These local development measurements are observations, not production SLOs or a substitute for a representative homelab benchmark.

The scale run found and fixed a keyset-pagination precision bug: converting PostgreSQL `created_at` through JavaScript `Date` dropped microseconds, so dense sets with tied timestamps skipped rows within each date bucket. The cursor now preserves PostgreSQL timestamp text at full precision while the public `createdAt` remains ISO formatted. A real-PostgreSQL integration regression creates tied timestamp entries and verifies all cursor pages return each one exactly once.

Reviewing the scale fixture found that its transaction revisions named one account while journals posted against a second account. The seeder now creates and posts against the same scale account, and Playwright asserts its ledger-derived balance is exactly `-10000` minor units after 10,000 one-minor-unit expenses. A clean current-worktree rerun on 2026-10-23 seeded 10,000 balanced ledger entries in 25,148 ms. The owner retrieved 10,000 unique transaction IDs in 100 pages over 5,022 ms total (33 ms API page p95), verified incremental Activity rendering from 25 to 50 rows and the expected account balance, then authenticated as a second user and confirmed the activity list and account list contained none of the owner fixture. The test passed and the disposable stack/tmpfs database were removed. These are local development measurements, not a production SLO or homelab benchmark; representative-hardware review remains open.

The scale seeder also rejects remote database hosts even when test opt-in and the database name are correct. A remote-host URL was refused before connection; the API typecheck passed after adding this guard.

Compose starts PostgreSQL, runs all migrations to completion, waits for the API readiness endpoint, then serves the web client. Bootstrap the disposable owner and disposable E2E users locally before database-backed tests. The seed command accepts a new email each time, so stateful browser checks can use isolated accounts without exhausting the login throttle. The standard browser fixture expects `owner@example.test`, `second@example.test`, and `sheet@example.test`; the FIN-019 process-crash test uses a separate `crash@example.test` account so its retained archived-account fixtures cannot change browser expectations. Reliability journeys use separate `accounts-stale`, `quickadd-retry`, `card-payment-ui`, `dashboard-refresh`, `manila-date`, `reports-snapshot`, `session-recovery`, and `owner-isolation` users, as shown in the seed loop above. CI creates the four standard fixture users with the same restricted seed command. The SQL contract suite verifies account and category checks, composite owner references, append-only postings, positive exact amounts, per-owner idempotency uniqueness, and deferred balanced-journal enforcement. API database tests exercise the ledger writer, account opening balances, category lifecycle, expense/income/transfer/refund/adjustment commands, card liability/payment/statement commands, recurring bill generation/payment, revision commands, and activity query behavior against PostgreSQL, including deterministic day-31 February handling, owner scope, statement allocation limits, and linked bill payments. Playwright covers desktop and Pixel 7 mobile emulation, honest empty-state content, database readiness, private login, secure cookie attributes, CSRF and origin rejection, profile/session recovery, cross-user isolation, preferences, Manila server date despite a skewed browser clock, account, category, transaction creation/replay/conflict, transfer/refund/adjustment flows, card detail/payment and Bills routes, edit/audit/delete flows, ledger-derived balances, rename/archive history, invalid inputs, logout, invalid credentials, and rate limiting. Authenticated identity, financial, and export responses are checked for `Cache-Control: private, no-store`; cross-user CSV and JSON exports are checked for transaction-ID isolation. The local release review authenticates once, reuses the session across its desktop and mobile contexts, and therefore remains repeatable under the API's intentional five-attempt login limiter. Routine validation is local and uses one worker because the acceptance fixtures intentionally share a database state; no GitHub Actions run is needed for these checks.

The separate `test` Compose profile exposes an ephemeral PostgreSQL instance for focused integration suites. The checked-in `compose.local-test.yaml` override exposes the normal disposable stack's API and PostgreSQL ports only when local host-driven integration or Playwright tests need them; the base Compose topology exposes only the web port.

## Environment limitations

The local Docker daemon is available after refreshing the shell's `docker` group membership. The Compose-backed suite was run locally against PostgreSQL, the API, and the web container. GitHub Actions remains a repository protection gate for pull requests, while routine feature validation stays local to preserve the action-minute budget. The PR workflow runs only for pull requests targeting `dev` or `main`, uses Node 22.22 throughout, and cancels an older in-progress run when a newer commit supersedes it.

Production image build targets are separate from the development Compose images. Build them locally with `docker build -f apps/api/Dockerfile.production -t monikey-v2-api:local-prod .`, `docker build -f apps/web/Dockerfile.production -t monikey-v2-web:local-prod .`, and `docker build -f apps/api/Dockerfile.migrate -t monikey-v2-migrate:local .`. All three runtimes refresh/upgrade Alpine packages, run nonroot, and omit npm/corepack. The API runtime includes production dependencies and Node only. The migration image installs Prisma without optional packages and successfully applies all migrations to a fresh disposable PostgreSQL database. The web image serves the Vite bundle through nonroot Nginx, proxies `/api/` to the `api` service, and adds CSP, frame, MIME, referrer, and permissions headers. Nginx sends `/sw.js` with `Cache-Control: no-cache`, omits query parameters from access logs, and Fastify redacts request URLs from API logs. Local Trivy HIGH/CRITICAL results are zero for all three final image IDs; Syft SPDX SBOMs are generated locally. HSTS remains deferred until the private HTTPS hostname and CA trust are verified. See [`runbooks/production-images.md`](runbooks/production-images.md) for evidence. These images have not been published or deployed.

### Local Playwright acceptance — 2026-10-23

- `npx playwright test --workers=1` completed against the local browser app, the actual API image, and PostgreSQL: 24 passed and 8 expected project-specific skips across desktop Chromium and Pixel 7 emulation. This includes account onboarding and ownership, categories, balanced expense/income commands, reports/exports, session security, Quick Add, PWA/offline behavior, and rate limiting.
- Used a fresh disposable PostgreSQL container backed by tmpfs, applied all five migrations, and seeded only the three documented E2E users. The persistent development database was not used for test writes.
- The existing dev API already occupied host port 3000, required by direct API calls in Playwright. It was stopped temporarily; the test API used port 3000 and the dev web app on 5173. The dev API was restarted and readiness returned `{"status":"ok","database":"connected"}`. All test-only containers were removed.
- Docker access in this login session required `newgrp docker` because the shell had not inherited the user's `docker` group membership. No GitHub Actions run was started.

### Port-isolated local Playwright stack — 2026-10-23

- Added `compose.e2e.yaml` and `e2e:stack:up` / `e2e:stack:down` scripts. The stack builds the checked-out API and web source, runs all migrations against a fresh tmpfs PostgreSQL database, and uses ports 18080 (web) and 13000 (API). It can run alongside the regular development stack.
- Playwright now takes the UI origin from `PLAYWRIGHT_BASE_URL` and its direct API origin from `PLAYWRIGHT_API_BASE_URL`; defaults remain localhost ports 5173 and 3000.
- Full `npx playwright test --workers=1` with both overrides passed: 24 passed, 8 expected project-specific skips across desktop Chromium and Pixel 7 emulation. Login, owner isolation, account/category mutations, balanced transaction flows, reports/exports, Quick Add, and rate limiting all passed against the actual API and PostgreSQL.
- `npm run compose:check`, ESLint on the changed E2E files, Playwright discovery, and the full `npm run validate` gate passed. All 13 PostgreSQL integration tests also passed through the stack’s loopback-only port 15432. The temporary project and tmpfs database were removed; existing development services remained up and API readiness returned `{"status":"ok","database":"connected"}`. No GitHub Actions run was started.

### Local export-safety regression check — 2026-10-23

- Extended CSV formula-prefix detection to include C1 controls (`U+007F–U+009F`) in addition to whitespace and C0 controls, and added assertions covering all four formula markers (`=`, `+`, `-`, `@`) after C1/Unicode whitespace prefixes.
- On a fresh tmpfs PostgreSQL stack, all 13 API integration tests passed. Playwright completed with 24 passed and 8 expected project-specific skips across desktop and mobile. The test-only stack was removed; the persistent development stack remained healthy. No GitHub Actions run was started.

### Private cache and export-isolation contract — 2026-10-23

- Cross-checked the master plan's authenticated cache requirement against the API handlers. Fixed the shared `onSend` hook so it supplies `private, no-store` without overwriting stricter route headers, and aligned the explicit profile/session/CSRF responses with that policy.
- Extended Playwright to assert the cache directive for identity, sessions, account/category/card/dashboard, and CSV/JSON export responses. The owner/secondary-user journey now checks owner transaction IDs appear in the owner's CSV and are absent from the second user's CSV and JSON export.
- A fresh worktree-built Docker stack passed all 13 PostgreSQL integration tests and 24 Playwright tests with 8 expected project-specific skips. `npm run validate`, `npm run compose:check`, and `git diff --check` also passed. The tmpfs project was removed; the regular development stack remained healthy. No Actions run was started.

### Cross-user IDOR regression coverage — 2026-10-23

- Expanded the real-API Playwright negatives to cover foreign account listing/detail/update/archive/activity, card payment and statement create/read/correction, bill listing/update/occurrence enumeration/pay/skip, transaction list/detail/edit/delete/audit, monthly report totals, private category names, and CSV/JSON transaction IDs.
- The foreign account-specific activity route returns the same empty owner-filtered result as an unknown account ID; direct account detail returns 404. Other guessed foreign resources return not found or remain absent from the other owner's collection.
- Against a fresh tmpfs PostgreSQL stack, the financial-account/card/bill and category browser journeys passed (2 desktop cases; their 2 mobile duplicates are intentionally skipped). This is targeted feature evidence, not a claim that every route has undergone independent security review.

### Local UX and accessibility baseline — 2026-10-23

- Ran `npm run review:local` on the isolated tmpfs stack with the actual API and PostgreSQL. All 18 route/viewport combinations passed (nine routes at desktop 1440px and Pixel 7-sized 412px) in light and dark themes.
- All 36 axe scans reported zero WCAG 2A/2AA violations. Keyboard traversal visited visible focusable controls with zero focus-style failures. Both viewports passed reduced-motion checks.
- Both viewports reported zero overflow, unnamed controls, undersized targets, page errors, and API errors. Report API p95 was 21 ms desktop and 12 ms Pixel 7-sized.
- The suite’s web-vitals samples were desktop FCP 48–832 ms/LCP 68–832 ms/CLS 0–0.057; Pixel 7-sized FCP 52–148 ms/LCP 56–148 ms/CLS 0. These are local development observations, not production SLOs.
- The E2E project was removed afterward; the persistent development stack remained healthy. Full screen-reader, physical-device, and owner review remain open.

### Local response-loss retry and repeatable acceptance — 2026-10-23

- Quick Add now persists the idempotency key for the exact pending transaction payload in session storage (with an in-memory fallback). It clears the key after a successful response and reuses it after an ambiguous failure, including across a page refresh in the same tab.
- Added a real-stack Playwright scenario that lets the API commit a transaction in PostgreSQL, replaces the response with an injected 500, and retries the unchanged form. The retry carries the same key and resolves to the same transaction ID; the activity feed still contains one transaction.
- The category owner-isolation check signs in as the separately seeded `sheet@example.test` user, avoiding repeated use of the owner account against the intentional login throttle.
- Local evidence: full Playwright 24 passed / 8 expected mobile project skips; all PostgreSQL integration suites passed; `npm run validate` passed (lint, types, production build, finance unit/invariant tests, formatting, secret scan, and audit with zero vulnerabilities). `git diff --check` and Compose configuration checks passed. No GitHub Actions run was started.

### Post-retry full route/accessibility rerun — 2026-10-23

- Re-ran `npm run review:local` on the isolated worktree-built Docker stack after the retry and E2E fixture changes. All 18 route/viewport combinations completed (nine authenticated routes at desktop 1440px and Pixel 7-sized 412px).
- All 36 light/dark axe WCAG 2A/2AA scans reported zero violations. Keyboard traversal reported zero focus failures; reduced-motion checks passed at both viewports. Each route reported zero horizontal overflow, unnamed controls, undersized targets, page errors, or API errors.
- The desktop report API p95 sample was 11 ms. Local development timing is observational, not a production SLO.
- This remains automated local evidence; screen-reader, physical-device, and owner review remain open. No GitHub Actions run was started.

- Follow-up fault-injection strengthening: the response-loss journey now reloads the page after the injected post-commit 500, restores the same amount/account/category, and retries in the same tab. A targeted desktop Playwright run passed, proving the session-storage key survives the reload and the replay returns the committed transaction. `npm run validate` and `git diff --check` passed after this change.

### Five-width owner-review matrix — 2026-10-23

- Expanded `npm run review:local` to cover the owner checklist's 360, 390, 768, 1440, and 1920 CSS-pixel widths. Phone widths emulate touch; tablet and desktop use standard pointer settings.
- Against the isolated Docker PostgreSQL/API stack, all nine authenticated routes passed at all five widths (45 route/viewport combinations). The report showed zero horizontal overflow, unnamed controls, undersized targets, keyboard focus failures, page errors, or API errors.
- All 90 light/dark axe WCAG 2A/2AA scans reported zero violations. Reduced-motion checks passed at all five widths. API p95 observations were 19 ms (360), 16 ms (390), 12 ms (768), 10 ms (1440), and 12 ms (1920); these local development samples are not production SLOs.
- This automated matrix does not complete the human device, screen-reader, contrast walkthrough, or owner sign-off checklist.

Set `MONIKEY_REVIEW_SCREENSHOT_DIR` to an output directory to save Home screenshots in light and dark themes at each of the five responsive widths. Use a disposable seeded review user; screenshots are browser emulation and must not contain real financial data.

- With `MONIKEY_REVIEW_SCREENSHOT_DIR` set, the same successful 45-combination review saved ten Home screenshots (light and dark at all five widths) from the isolated disposable-user session. The images live in the Obsidian project vault; they are browser emulation, not physical-device captures.

### Randomized posting-reference safety — 2026-10-23

- Added a PostgreSQL-backed fast-check property to the transaction integration suite. Across 30 generated expense attempts, source-account IDs are selected from a foreign owner's account, an archived owner account, and a nonexistent UUID; every attempt returns the safe not-found error. Another 30 attempts generate category references from foreign, archived, and missing categories and are rejected the same way. The test runs through `createIncomeOrExpense` and verifies no invalid reference can reach journal posting.
- `npm run test:transactions --workspace @monikey/api` passed all seven transaction/dashboard integration tests against the isolated real PostgreSQL stack. `npm run validate` and `git diff --check` passed. No GitHub Actions run was started.

### Backup restore invariants — 2026-10-23

- Strengthened `restore:local` to verify applied migrations, balanced journals with at least two postings, current transaction revisions, and a journal for every posted transaction. It logs counts only. `BACKUP_DATABASE` allows use of the isolated E2E database without changing the development Compose database.
- A new tmpfs stack was seeded through the API with a disposable owner, an opening-balance account, and an expense. A 73,100-byte custom-format backup restored successfully: 1 user, 1 account, 2 transactions, 2 journals, 4 postings, and 2 revisions. All checks passed; the restore DB and archive were removed.

- Recovery-helper path safety was tested locally: an in-repository directory whose name starts with `..`, a symlink from `/tmp` into the repository, and an invalid source database name were each rejected before creating an archive. The real-stack backup/restore drill then passed again with the hardened path resolution (73,107-byte test archive, removed after validation).

### FIN-014 and FIN-016 regression coverage — 2026-10-23

- Added a desktop Chromium Playwright path that records an expense large enough
  to make its account negative. It verifies the warning is visible, confirms
  the action explicitly, and reads the actual API balance (`-500` minor units).
  PostgreSQL transaction integration already verifies acknowledged negative
  balances succeed through the balanced journal writer.
- Extended the real-PostgreSQL card statement test: after a partial payment
  allocates 40,000 minor units against a 100,000 statement, a later 25,000 card
  purchase leaves the statement due at 60,000. The later purchase does not
  change the older statement remainder.
- All eight PostgreSQL integration suites passed (17 tests). The fresh-stack
  full Playwright run passed 25 tests with 9 expected desktop-only/mobile
  skips. `npm run validate`, `npm run compose:check`, changed-file Prettier,
  and `git diff --check` passed. The tmpfs stack was removed; no GitHub Actions
  run was started.

### FIN-001–FIN-020 acceptance reconciliation — 2026-10-23

- Added `docs/FINANCIAL_ACCEPTANCE_MATRIX.md` mapping all 20 plan examples to
  concrete API/PostgreSQL or Playwright cases. Updated FIN-001–FIN-008
  transaction/report fixtures to use the plan's stated amounts.
- The exact fee case found a reporting omission: transfer journals were
  excluded from monthly reports, hiding their expense fee leg. Monthly report
  queries now read the fee category from the current revision; asset postings
  keep transfer principal out of income and spending. The PostgreSQL test
  asserts a no-fee ₱1,000 transfer leaves report totals unchanged, and a
  ₱1,000 transfer with a ₱15 fee reports exactly ₱15 of expense.
- After the fix, all eight PostgreSQL integration suites passed (17 tests),
  and the rebuilt real API/web/PostgreSQL stack passed full Playwright with
  25 passed and 9 expected desktop-only/mobile skips. No GitHub Actions run
  was started. See the financial acceptance matrix for individual case
  evidence and limitations.

### Local browser failure telemetry — 2026-10-23

- Extended `npm run review:local` to capture and fail on unhandled Promise
  rejections, browser console errors, and failed API network requests, in
  addition to page exceptions and HTTP API errors. Route counters are sampled
  from before navigation so failures during initial load are attributed.
- Rebuilt the isolated Docker stack and passed the complete 45
  route/viewport review across nine routes and five widths. All 90 light/dark
  axe scans, keyboard focus checks, reduced-motion checks, and error counters
  passed; each error category reported zero. The tmpfs stack was removed.
- `npm run validate`, `npm run compose:check`, Prettier, and `git diff --check`
  passed locally. No GitHub Actions run was started. Human device, screen
  reader, contrast, and owner review remain open.

### Application metrics and Prometheus rule validation — 2026-10-23

- `npm run validate` passed with the new route-normalization and histogram unit
  tests included. `npm run compose:check`, formatting, and `git diff --check`
  passed; `npm audit` reported zero vulnerabilities.
- The actual API/PostgreSQL Playwright readiness journey passed on desktop
  Chromium and Pixel 7 emulation. It fetched API-root `/metrics`, verified the
  connected DB gauge, safe route-template labels, absence of test user/resource
  and money fields, and `Cache-Control: no-store`.
- Grafana dashboard JSON and alert YAML parsed locally. Prometheus `promtool`
  3.5.0 reported `SUCCESS: 9 rules found`. Backup and Kubernetes metric names
  remain integration assumptions; no live scrape/routing test occurred.
- The isolated tmpfs stack was stopped and removed. No Actions run or homelab
  change occurred.

### Production backup container and rotation drill — 2026-10-23

- Built `apps/api/Dockerfile.backup` from digest-pinned PostgreSQL 17.11 / Alpine
  3.24.3. The final image removes the upstream `gosu` binary because the
  workload runs its backup script directly as non-root UID/GID 70. The
  container ran against the real API test's PostgreSQL database and a separate
  disposable Docker volume.
- Eight actual `pg_dump -Fc` runs produced valid archives; `pg_restore --list`
  and SHA-256 verification passed. Daily retention remained at seven. The
  weekly rotation pruned to four, and a forced UTC week produced a hard-linked
  weekly snapshot with the same inode as its daily archive.
- A forced unreachable database made the job exit nonzero, set
  `monikey_backup_last_run_success` to 0, preserved the prior success time, and
  left all seven last-known-good daily archives intact.
- After the actual API/PostgreSQL Playwright finance journey seeded disposable
  data, a new archive restored into an isolated database with
  `--exit-on-error`: 3 users, 7 transactions, 10 journals, 21 postings, and 9
  revisions. The restore DB was dropped. The backup Docker volume and E2E
  Compose stack were removed afterward.
- Kustomize v5.7.1 rendered the complete root deploy tree as 17 resources;
  kubeconform v0.6.7 validated all 17 against the v1.30 schema. This is schema
  validation, not validation against the unobserved live cluster. No Actions run
  occurred.
- Trivy 0.76.0 reported zero HIGH/CRITICAL findings in the derived local image.
  The CronJob now references that image through a published-digest placeholder;
  the manual release workflow builds it and retains the digest scan and SPDX
  SBOM. No image was published.
- Rebuilt the derived image on 2026-10-23 and ran it against a fresh disposable
  PostgreSQL 17.11 container. The actual backup entrypoint completed, its
  archive passed `pg_restore --list` and `sha256sum -c`, and file inspection
  confirmed mode 0600 and owner 70:70. Syft 1.33.0 generated a local SPDX 2.3
  SBOM containing 47 packages; retain a new SBOM for the published digest.

### Release verifier hardening — 2026-10-23

- `scripts/verify-release-main.mjs` now paginates all PR/check-run results before selecting the latest required check. `node --check` and repository ESLint passed. The GitHub read-only API verification must be rerun for the pagination change; no release workflow or Actions run was started. The image release job now attempts to retain the digest map and any completed scans/SBOMs after a later publish or scan step fails.

### Private CA and SOPS bootstrap template — 2026-10-23

- Kustomize v5.7.1 rendered the default V2 application tree (20 resources). kubeconform v0.6.7 validated all 20 against Kubernetes v1.30 and downloaded cert-manager Certificate/Issuer CRD schemas. The separate cutover Ingress validated as one Kubernetes v1.30 resource. The cutover Ingress is deliberately excluded from the default root to avoid sharing V1's active hostname before approval.
- The SOPS secret generator was exercised with SOPS 3.10.2 and a disposable age key. The encrypted test artifact contained no plaintext credentials, decrypted successfully against the disposable key, and had mode 0600. The temporary private key, encrypted artifact, and decrypted test file were removed. No owner recipient or production secret was created.
- `npm run lint`, `npm run format:check`, actionlint 1.7.7, `node --check` for both local helper scripts, and `git diff --check` passed. No Actions run, live certificate issue, device trust install, GitOps edit, or cluster command occurred.

### Current-worktree production image and Phase 6 runtime check — 2026-10-23

- Used `newgrp docker` as requested to access the local Docker daemon without
  changing socket permissions. Built fresh uniquely tagged web, API,
  migration, PostgreSQL, and backup images from the current worktree. The
  existing development stack remained healthy and was not stopped or changed.
- Started an isolated Compose project with tmpfs PostgreSQL, read-only root
  filesystems, dropped capabilities, and no-new-privileges. PostgreSQL became
  healthy; the migration image completed and recorded all five migrations;
  API and web containers became healthy. API readiness returned HTTP 200 with
  `database=connected`; the web shell returned HTTP 200 with CSP/security
  headers; the web `/api` proxy returned the actual API readiness response
  (HTTP 200).
- Trivy 0.76.0 scanned all five fresh image tags at HIGH/CRITICAL severity
  without ignoring unfixed findings. Every image reported zero findings.
  Syft 1.33.0 generated SPDX inventories: web 71, API 245, migration 160,
  PostgreSQL 47, backup 47 packages.
- Removed the isolated Compose project and tmpfs database. The pre-existing
  development API/web/DB remained healthy. No GitHub Actions run, GHCR push,
  cluster command, or GitOps change occurred.

### Prometheus API scrape integration fragment — 2026-10-23

- Inspected the exact pinned Prometheus Community Helm chart 25.19.1 from its release artifact and confirmed the chart supports `extraScrapeConfigs` as a string value.
- Added a static scrape target for `api.monikey-v2.svc.cluster.local:3000/metrics`, which avoids Kubernetes discovery RBAC and matches the NetworkPolicy namespace allowlist. Corrected migration and certificate alert selectors from the V1 namespace to `monikey-v2`.
- Prometheus 3.5.0 `promtool check config` accepted the extracted scrape fragment and `promtool check rules` found nine valid rules. This checks syntax only; live DNS, traffic, exporters, and Alertmanager delivery remain unverified.

### Backup metrics exporter and six-image release update — 2026-10-23

- Added a minimal nonroot backup-metrics image that mounts the backup PVC read-only, exports only five allowlisted `monikey_backup_*` values, and reports missing/corrupt files through validity gauges. Three unit tests passed for valid values, missing files, and invalid/duplicate/unknown/labeled content.
- Built the exporter image locally and ran it read-only with all capabilities dropped and no-new-privileges. A valid file returned only expected metrics; removing the file returned `file_present=0` and `file_valid=0`. The temporary container was removed.
- Trivy 0.76.0 found zero HIGH/CRITICAL vulnerabilities (unfixed included) in the exporter image. Syft 1.33.0 generated a 21-package SPDX inventory.
- Added a monitoring-only Service/NetworkPolicy and static scrape target, plus a tenth alert for missing/invalid backup metrics. Prometheus 3.5.0 `promtool` accepted both API/backup scrape targets and all ten rules. The root Kustomize output then had 23 resources; all 23 and the separate cutover Ingress passed kubeconform. Live scrape, PVC attachment, and alert delivery remain unverified.

### Fresh local acceptance from current worktree — 2026-10-23

A fresh `monikey-e2e` Docker Compose project used tmpfs PostgreSQL and the current worktree. With the three documented disposable test users seeded, all eight PostgreSQL integration suites passed (17 tests total). The one-worker desktop Chromium and Pixel 7 Playwright run passed 25 tests with 9 intentional project skips, including the API restart/idempotency retry path. `npm run validate` and `npm run compose:check` also passed. The isolated project and tmpfs database were removed; the pre-existing development API, web, and PostgreSQL containers remained healthy. GitHub Actions, GHCR, GitOps, and the homelab cluster were not used or changed.

### Fresh responsive accessibility release review — 2026-10-23

- Re-ran `npm run review:local` against the healthy local API/web stack across nine authenticated routes and five widths (360, 390, 768, 1440, and 1920px), for 45 route/viewport checks and 90 light/dark axe scans. All passed with zero WCAG 2A/2AA violations, unnamed or undersized controls, keyboard-focus failures, overflow, page/API/console errors, network failures, or unhandled rejections. Reduced-motion checks passed at every width. Report API p95 was 38ms in this run.
- This is automated browser-emulation evidence, not actual-device, screen-reader, independent QA, or owner sign-off. The owner checklist remains pending.

### Workflow and OpenAPI contract local verification — 2026-10-23

- `actionlint` 1.7.7 accepted the current `.github/workflows/ci.yml`; no GitHub Actions run was started.
- `npm run test:contracts` initially compared against the pre-existing development API image and detected that its runtime OpenAPI document was stale. A newly built isolated stack from the current worktree returned a declaration that matched `packages/contracts/src/generated/openapi.d.ts` exactly with `API_SPEC_URL=http://localhost:13000/openapi.json`.
- The isolated project and tmpfs database were removed; the persistent development API/web/PostgreSQL stack remained healthy. Testing docs now warn that contract checks must target an API built from the current worktree.

### Release verifier regression tests — 2026-10-23

- Added `scripts/verify-release-main.test.mjs` and `npm run test:release-verifier`, included in `npm run validate`. A local stub GitHub API verifies pagination beyond the first 100 check runs, successful main-merge/check reporting, rejection of a failed newest check even when an older check succeeded, and rejection of a commit that is not the merged PR commit.
- `npm run test:release-verifier` passed all three cases. The tests use only a localhost stub server; they make no GitHub API calls and start no Actions runs.

### Fresh full-stack recovery acceptance — 2026-10-23

A new isolated Compose build ran the actual API and PostgreSQL with three disposable test users. Playwright passed 25 tests with 9 expected skips. A mode-0600, 91,767-byte custom-format backup from `monikey_e2e` passed `pg_restore --list`; SHA-256 was `1367b1b77fb12905169c0225147f601b938ddcc809349902394fb53ea334317e`. Isolated restore checked migrations, balanced journals, current revisions, and journal links for posted transactions (3 users, 6 accounts, 16 transactions, 22 journals, 45 postings, 20 revisions). The archive, restore database, and tmpfs stack were removed. The development DB remained untouched and services healthy. This does not satisfy production PVC/CronJob/Secret or owner acceptance.

### Current monitoring signal verification — 2026-10-23

- Prometheus 3.5.0 `promtool check rules` accepted all eleven rules, and
  `promtool test rules` verified the journal-invariant alert stays quiet at zero
  and fires after a counter increase and its `for` interval elapses. Both
  commands used the locally available pinned container image. The Grafana
  dashboard JSON parses with a stat panel querying the same ten-minute metric.
- A fresh isolated tmpfs PostgreSQL run passed all nine integration suites
  (18 tests); the ledger service integration test confirmed unbalanced postings
  increment the label-free counter and unrelated foreign-account rejection does
  not. `npm run validate` also passed. No Actions run was started.

### Fresh current-worktree CI-order acceptance — 2026-10-23

- In an isolated tmpfs Compose project, the current worktree built and started PostgreSQL, migrations, the actual API, and web. The four disposable users were seeded, then `npm run test:integration` passed all nine suites (18 tests), including process-kill rollback for a transfer. Running the canonical one-worker `npm run test:full-stack` against the same database passed 25 Playwright tests with 9 expected project-specific skips across desktop Chromium and Pixel 7 emulation.
- The test project was removed with `npm run e2e:stack:down`; the persistent development PostgreSQL/API/web containers remained healthy. No GitHub Actions workflow was run. This does not close actual-device, screen-reader, independent QA, owner, or production gates.

### Fresh CI-order acceptance after Docker-group activation — 2026-10-23

- This shell initially could not access `/var/run/docker.sock`; entering the already-configured `docker` group with `newgrp docker` restored access without changing socket permissions. The existing development API/web/PostgreSQL containers were healthy before the test.
- Rebuilt a fresh `monikey-e2e` Compose project from the current worktree with tmpfs PostgreSQL. Seeded only the documented disposable owner, second-user, sheet, and crash-test users. `npm run test:integration` passed all nine PostgreSQL suites (18 tests), including balanced ledger writes, tenant scoping, deterministic transfer locking, injected posting rollback, card statements, recurring bills, reports, idempotency replay, and API process-kill rollback.
- With the Playwright parent process also running inside `newgrp docker`, the canonical one-worker full-stack run passed 25 tests with 9 expected mobile-project skips across desktop Chromium and Pixel 7 emulation. This includes API restart and concurrent idempotent replay. A preceding attempt outside the Docker group passed 24 cases but could not execute the test's Docker API-restart step; its contaminated tmpfs stack was discarded before the successful clean run.
- Removed the isolated project and tmpfs database. Verified the persistent development API, web, and PostgreSQL containers remained healthy. No GitHub Actions run, GHCR publication, GitOps change, or cluster action occurred. Physical-device, screen-reader, independent QA, owner, and production acceptance remain open.

### Fresh and previous-V2 migration compatibility — 2026-10-23

- A fresh isolated `monikey-e2e` stack applied the complete current migration chain to empty tmpfs PostgreSQL. In a second disposable database on the same instance, a temporary migration directory containing the first four migrations applied the previous V2 schema through `20261022230000_category_icons`; the full current migration set then applied `20261023000000_cards_bills` successfully.
- `prisma migrate status` reported the database schema up to date. Direct PostgreSQL inspection confirmed all five migrations finished and the `card_statements`, `bills`, and `bill_occurrences` tables exist. This covers the master plan's fresh-empty and previous-V2 migration paths locally.
- Removed the isolated Compose project and its tmpfs database, which also removed the migration-test database. The persistent development database was not used or changed. This does not establish destructive rollback reversibility or live Argo hook behavior; those remain separate release gates. No GitHub Actions run occurred.

### Backup image restricted-runtime acceptance — 2026-10-23

- Built the current backup image and ran it against isolated tmpfs PostgreSQL with the CronJob's UID/GID 70, read-only root filesystem, all capabilities dropped, and `no-new-privileges`. The custom-format archive was nonempty, `pg_restore --list` passed, and the metrics file reported a successful run.
- Repeated the run with an intentionally unresolvable disposable DB host and a two-second connection timeout under the same restrictions. The job exited nonzero, `monikey_backup_last_run_success` changed to 0, the previous nonzero success timestamp and archive size remained, and the prior archive was still present.
- Removed the temporary backup volume and isolated PostgreSQL project; the persistent development stack remained healthy. No production data, GitHub Actions, GHCR, GitOps, or cluster resources were used. This validates the image/script failure boundaries, not production PVC behavior or in-cluster networking.

### Backup-metrics semantic validation — 2026-10-23

- Expanded exporter unit cases to reject nonbinary run status, fractional timestamps/byte counts, available bytes greater than volume size, and a successful status without a nonzero timestamp and archive size. All four exporter tests passed, and the full `npm run validate` gate passed with zero npm audit findings.
- Rebuilt the backup-metrics image and ran it nonroot with read-only root, dropped capabilities, and `no-new-privileges`. A valid metrics file produced `monikey_backup_metrics_file_valid 1` and all five data series. An impossible run status of 2 produced `..._valid 0` and no backup data series. The container and temporary fixture were removed; persistent development services remained healthy.

### Backup alert-rule timing tests — 2026-10-23

- Prometheus 3.5.0 `promtool check rules` accepted all eleven checked-in alert rules. `promtool test rules` now passes tests for the ledger invariant plus recent, stale, and absent backup timestamps, failed runs, invalid metrics files, and low backup-volume space. The backup tests check quiet fresh-success behavior, non-firing before each configured `for` window, and firing after it, including alert labels and annotations.
- The absent-metric case initially expected no `job` label; promtool showed `absent()` preserves the `job` equality matcher. The fixture expectation was corrected and the full rule test passed. This is local rule evaluation only; live scraping, Alertmanager routing, and Loki integration remain unverified.

### UTC backup schedule schema check — 2026-10-23

- Set the production backup CronJob's `timeZone` to `Etc/UTC` so its daily 02:00 schedule agrees with UTC archive identifiers and freshness metrics regardless of the Kubernetes controller's local timezone.
- Kustomize v5.7.1 rendered the full deployment tree (23 resources); kubeconform v0.6.7 with Kubernetes v1.30 and cached cert-manager CRD schemas validated all 23 resources. No cluster job was applied or run.

### Fresh current-worktree local acceptance — 2026-10-23

A fresh `monikey-e2e` Compose project rebuilt the API, web, and migration images from this worktree and migrated a tmpfs PostgreSQL database. After creating the documented disposable owner and three E2E users, all nine PostgreSQL integration suites passed (18 tests). The subsequent one-worker Playwright run against the actual API and database passed 25 tests with 9 expected mobile-project skips across desktop Chromium and Pixel 7 emulation. `npm run validate` and `npm run compose:check` also passed locally. The separate `prisma/tests/financial_schema.sql` contract passed against another fresh tmpfs database and rolled back its test transaction. Both isolated projects and tmpfs databases were removed. No GitHub Actions run, image publication, GitOps edit, or cluster action occurred.

### Fresh current-worktree responsive review — 2026-10-23

`npm run review:local` passed against a newly built isolated Docker stack with the actual API and tmpfs PostgreSQL. All nine authenticated routes completed at five widths (360, 390, 768, 1440, and 1920px): 45 route/viewport checks and 90 light/dark axe scans. The review reported no WCAG 2A/2AA violations, horizontal overflow, unnamed or undersized controls, keyboard-focus failures, browser/API/console errors, failed API requests, or unhandled rejections. Reduced-motion checks now instantiate the app's `.skeleton-line` animation and `.amount-control` transition classes and assert their computed durations are 0.01ms with one animation iteration; those probes passed at every width. The isolated stack was removed. This is automated browser emulation; physical-device, screen-reader, independent QA, and owner acceptance remain open.

### Fresh local PostgreSQL and browser acceptance — 2026-10-23

- Rebuilt the isolated `monikey-e2e` Compose stack from the current worktree using Docker through the configured `docker` group. The stack used the actual API, migrations, web app, and a fresh tmpfs PostgreSQL database.
- Seeded only disposable owner and test users. All nine PostgreSQL integration suites passed (18 tests), including transfer process-kill rollback and concurrent idempotent replay.
- The canonical one-worker Playwright run passed 25 tests with 9 expected mobile-project skips across desktop Chromium and Pixel 7 emulation.
- `npm run validate` passed after correcting Prettier formatting in `docs/IMPLEMENTATION_STATUS.md`. The E2E stack was removed with its tmpfs database; no GitHub Actions run occurred.
- This remains local automated evidence. It does not close physical-device review, independent QA, owner acceptance, or Phase 6 production gates.

### Completed onboarding destination regression — 2026-10-23

- The signed-in `READY` state at `/onboarding` now directs owners to the implemented Accounts area instead of the Home page, and its copy no longer says account workflows are unavailable. The shared route panel accepts state-specific copy, and the header identifies this state as Accounts.
- The authenticated Playwright journey asserts the READY-state title, saved-journal message, Accounts header, and navigation to the page's Add account control. It passed in a fresh Docker PostgreSQL/API/web stack with the documented disposable users; the stack was removed afterward.
- Captured and visually inspected the rendered READY state at desktop viewport size. No real financial records were used.

### Architecture audit reconciliation — 2026-10-23

- Rechecked the homelab GitOps checkout: it is clean at `2369afce6161f8c3f3f970cf1e484e44b3227df9`, matching remote `main`. There is no kubeconfig, and `kubectl`, `argocd`, and `helm` are not available on PATH.
- Freshly rendered the current V2 Kustomize root (24 resources) with temporary Kustomize v5.7.1. Strict kubeconform v0.6.7 validation against Kubernetes 1.30.0 and cached cert-manager CRD schemas passed all 24 root resources and the separate cutover Ingress (25 total). This verifies source schema only, not live cluster state.

### Linked refund mutation protection — 2026-10-23

- Added real-PostgreSQL regression checks proving a partially refunded expense cannot be edited below the posted refund total, recategorized while its refund is posted, or voided while the refund remains posted.
- The rejected mutations leave the original/refund journal and revision counts unchanged. The existing transaction integration suite passed all 9 tests against the fresh isolated tmpfs PostgreSQL stack; API, database, and web containers were removed afterward.
- `npm run lint` and `npm run typecheck` passed for the updated service and integration test.

### Credit-card refund liability direction — 2026-10-23

- Corrected card-purchase refunds to debit the card liability while crediting the original expense category. The prior direction credited the liability, incorrectly increasing card debt.
- Extended the real-PostgreSQL transaction integration test: after an ₱800 card purchase, a ₱300 refund reduces card debt by ₱300 and monthly net expenses to ₱500; a later ₱300 card payment leaves debt at ₱400 and bank cash at ₱700. The refund journal is asserted to debit the card liability and credit the expense category.
- The transaction/dashboard integration suite passed all 9 tests against a freshly built isolated tmpfs PostgreSQL stack. Authenticated Playwright against the actual API passed the financial-account/card-statement journey with a ₱300 card refund and report-total assertion. Both disposable stacks were removed.
- This closes the local code/test gap for the master plan's card-purchase refund accounting identity. No GitHub Actions run was started.

### Concurrent bill-payment retry acceptance — 2026-10-23

- Extended the authenticated real-API/PostgreSQL Playwright bill flow to submit two simultaneous payments for one occurrence with the same idempotency key. Both return the canonical `PAID` occurrence and same expense transaction ID.
- A second request with a fresh key for the already-paid occurrence returns HTTP 409; the account remains debited exactly once.
- The targeted browser journey passed on a fresh isolated tmpfs PostgreSQL stack. The stack was removed after the run; no GitHub Actions run was started.

### Concurrent card-statement allocation acceptance — 2026-10-23

- Extended the same authenticated journey to race two distinct ₱40,000 payment requests against a statement with ₱70,000 remaining. Exactly one returns 201 and the other 409.
- The successful response, statement read, and later account reads confirm one ₱40,000 allocation, ₱30,000 remaining, and only one funding-account debit. A later issuer snapshot correction updates the remaining due from the persisted allocation total.
- The targeted Playwright test passed against the real API and fresh tmpfs PostgreSQL stack; its run also exercised the concurrent bill retry and duplicate-paid rejection. The disposable stack was removed. No Actions run was started.

### Current worktree validation rerun — 2026-10-23

- `npm run validate` passed on the current worktree, including lint, strict TypeScript checks, production builds, exact-money and ledger invariants, backup/secret/release/migration regression suites, formatting, reachable-history secret scanning (129 tracked files and 1,066 Git objects), and `npm audit` (zero vulnerabilities).
- Rebuilt a fresh isolated `monikey-e2e` stack with tmpfs PostgreSQL and the actual API/web containers. After seeding the four documented disposable users with their matching fixture credentials, `npm run test:integration` passed all nine suites and 18 tests. Coverage included balanced posting, account/category ownership, concurrent transfers, injected failure and process-kill rollback, card statements, bills, reports, and idempotency replay.
- The first run used the wrong disposable password for `crash@example.test` and failed before the process-crash assertion at authentication. No product code was changed; the clean rerun used the documented crash-user credential and passed. The stack and tmpfs database were removed by the command's exit trap.
- A fresh one-worker `npm run test:full-stack` run passed 25 Playwright cases with 9 intentional mobile-project skips, using desktop Chromium and Pixel 7 emulation against the actual API/PostgreSQL stack. An initial attempt seeded `sheet@example.test` with a mistyped password and produced three setup-time 401s; rerunning with the password expected by the committed browser fixture passed. The stack was removed afterward.
- A fresh P6-05 `npm run test:migration-upgrade` rerun on isolated tmpfs PostgreSQL applied the four previous V2 migrations, then `20261023000000_cards_bills`; Prisma reported the schema up to date and the verifier confirmed all five successful migrations plus the card/bill tables. The randomly named scratch database was dropped by the verifier, and the E2E stack was removed by its exit trap.
- A fresh P6-06 recovery recheck seeded one disposable owner, bank account, opening balance, and expense through the actual API. `backup:local` created a 73,118-byte custom-format archive and passed `pg_restore --list`; `restore:local` restored it to a separate database and verified one user, one account, two transactions, two balanced journals, four postings, and two revisions. The isolated restore database, tmpfs stack, archive, and temporary seed script were removed; the persistent development database was not used.
- No GitHub Actions run or live-cluster command occurred. Owner/device review, independent QA, and Phase 6 live release gates remain open.

### Backup archive headroom alert — 2026-10-23

- `MoniKeyBackupVolumeNearlyFull` now fires if less than 10% of backup-volume capacity is free or if free bytes are below the last successful archive size for 15 minutes. This detects a volume that has more than 10% free but cannot hold an archive as large as the previous successful dump.
- Prometheus 3.5.0 `promtool check rules` accepted all 12 alert rules; `promtool test rules` passed the full suite, including the 15%-free/20%-archive threshold case. This is a baseline only; a larger upcoming dump can still exceed the previous archive size. Live scrape and Alertmanager delivery remain unverified.
- The corrected current-worktree `npm run validate` passed lint, strict typecheck, production build, exact-money and invariant tests, backup-metrics, release/migration/workflow/secret-scan regressions, formatting, high-confidence secret scan (129 tracked files and 1,066 reachable Git objects), and `npm audit` with zero vulnerabilities. This was local validation; no GitHub Actions run was started.

### Authenticated route screenshot gallery and currency spacing — 2026-10-23

- Extended `npm run review:local` to save both light and dark captures for all nine authenticated routes at 390px phone and 1440px desktop, alongside the existing five-width Home captures. It also creates a disposable bank account and card through the real authenticated API, then captures Account Detail and Card Statements at those two sizes and both themes. These financial records exist only in the isolated tmpfs PostgreSQL stack.
- The current expanded run passed 45 route/viewport combinations and 90 light/dark axe scans with zero WCAG 2A/2AA violations, overflow, unnamed or undersized controls, focus failures, page/API/console errors, API network failures, or unhandled rejections. Reduced-motion checks passed. All eight detail-route captures were created. An accidental follow-up invocation against the persistent development user revealed that populated Home balances compute to negative letter spacing; the harness now rejects negative tracking while allowing zero or positive spacing. The successful final rerun used the isolated E2E stack, which was removed afterward; development services remained healthy.
- Visual inspection found that the `₱` symbol visually crowded the first digit on the large Home balance. `formatPhp` now inserts a narrow nonbreaking space after the currency symbol, and the Home balance no longer inherits negative tracking. The money package's five unit tests passed, and the browser review asserts that the Home balance has no negative letter spacing. See `docs/RELEASE_REVIEW.md` for the route matrix and human-review observations.
- The phone Activity title wraps to three lines and the empty desktop Reports layout uses a narrower left column; these remain observations for owner review, not automated failures. Physical-device, screen-reader, and owner acceptance remain open. No GitHub Actions run was started.
- After the currency-spacing implementation, `npm run validate` passed the current worktree: lint, typecheck, production build, money and finance tests, workflow/release/migration/backup/secret regressions, formatting, secret scanning (129 tracked files and 1,066 reachable Git objects), and npm audit (zero vulnerabilities).

### WCAG 2.2 AA axe coverage — 2026-10-23

- Extended both light and dark route scans in `npm run review:local` to include axe-core's `wcag22aa` tag alongside the existing WCAG 2.0 A/AA tags.
- Rebuilt the isolated tmpfs API/PostgreSQL/web stack and reran all 45 route/viewport combinations. All 90 light/dark axe scans passed with zero reported violations; keyboard traversal, focus visibility, reduced motion, touch targets, overflow, network, console, and API checks also passed.
- This is automated axe rule coverage, not a full WCAG conformance audit. Screen-reader, contrast, physical-device, independent QA, and owner acceptance remain open. The isolated stack was removed and no GitHub Actions run was started.

## Production web image and offline PWA acceptance — 2026-10-23

- The isolated E2E Compose stack now serves the production-built web image through Nginx, with its real API proxied on the same origin. This exercises the shipped asset/cache headers and deployment proxy path instead of Vite development modules.
- Expanded the shell-only PWA Playwright journey: after first load it switches offline, reloads the app, verifies the cached shell renders, proves API reads still fail offline, and confirms no API path was added to Cache Storage. Desktop Chromium and Pixel 7 emulation both passed.
- Fresh tmpfs PostgreSQL/API stack with disposable users: the full one-worker Playwright suite passed 25 tests with 9 expected skips. The initial dirty-stack attempt hit the intentional login limiter after repeat test/manual probes; the clean tmpfs rerun passed. The stack was removed afterward; the development services were not changed. No Actions run occurred.
- Offline fallback is a shell experience only. Financial data and API operations remain network-only; users cannot record transactions while disconnected.

## Account detail five-width review — 2026-10-23

- Expanded Account Detail and Card Statements from two viewport sizes to the full responsive matrix: 360, 390, 768, 1440, and 1920px. Both routes now run keyboard traversal, focus visibility, 44px target, unnamed-control, overflow, browser/API error, and axe checks in light and dark themes.
- Fresh isolated tmpfs PostgreSQL and actual API stack: all 55 route/viewport checks passed and all 110 axe scans tagged WCAG 2.0 A/AA and WCAG 2.2 AA reported zero violations.
- Regenerated the route screenshot gallery to 62 files: ten Home captures across five widths, 32 captures for the eight remaining standard routes at phone 390px and desktop 1440px, and 20 detail-route captures across five widths. The 360px Card Statements capture was visually inspected; title, form, and bottom navigation fit without horizontal overflow.
- Disposable stack cleanup completed after the run. Physical-device, screen-reader, contrast, independent QA, and owner review remain open. No GitHub Actions run occurred. See `docs/RELEASE_REVIEW.md`.

### Route gallery top-of-page capture correction — 2026-10-23

- Visual inspection found that keyboard traversal left the nested `.page-content` scrolled before the next route screenshot. The route-review harness now blurs the focused element and resets page-content, document, and window scroll before both light and dark captures.
- Regenerated the 62-image gallery after a passing 55-check/110-scan sweep. Inspected Activity and Bills at phone width in both themes; top captures now include the mobile brand, private-session notice, sign-out, route content, and bottom navigation. This corrects screenshot evidence only; no product UI change was needed.
- Added an automated capture-position assertion for all routes and detail views: the content and window scroll must be zero, and the app header plus session notice must fit in the viewport before capture. The fresh rerun passed all 55 checks and 110 scans with zero violations.
- The isolated tmpfs stack was removed, and the persistent development API remained healthy. Physical-device, screen-reader, independent QA, and owner acceptance remain open.

## Quick Add sheet focus restoration — 2026-10-23

- The authenticated Quick Add modal now captures its opening control and returns focus to that control after Escape-close, backdrop-close, or confirmed discard of an unsaved entry.
- `npx playwright test e2e/foundation.spec.ts -g 'authenticated quick add opens an accessible sheet' --workers=1` passed on desktop Chromium against production Nginx, actual API, and tmpfs PostgreSQL; Pixel 7 project was intentionally skipped because that viewport uses the full-page Quick Add route. The journey asserts initial close-button focus, Shift+Tab wrapping from the first to last enabled control, Tab wrapping back to the first, and focus returning to the Add trigger after Escape-close, backdrop-close, and confirmed discard.
- This improves keyboard context; full screen-reader and actual-device review remain owner/independent QA work. The isolated stack was removed and no Actions run occurred.

## Financial UI reliability remediation — 2026-10-24

- `npm run test:integration` passed all nine PostgreSQL-backed API suites (18 tests) on a fresh dedicated tmpfs QA database, including ledger posting, user scope, transfer rollback, cards, bills, reports, and idempotency. The report snapshot suite passed twice; its probe transaction is reversed in cleanup.
- `MONIKEY_HEALTH_TEST_DATABASE_URL=postgresql://monikey@localhost:15433/monikey_e2e npm run test:health --workspace @monikey/api` passed 2/2 tests: missing configuration fails readiness while liveness remains healthy, and PostgreSQL outage/recovery changes readiness correctly within the bounded check.
- `npm run test:unit` passed 15 tests (5 exact-money and 10 API tests); `npm run test:invariants` passed 3 property/invariant tests. `npm run lint`, `npm run typecheck`, API and web production builds, and `npm run compose:check` passed.
- `API_SPEC_URL=http://localhost:13001/openapi.json npm run test:contracts` passed against the actual Fastify API. `npm run format:check` and `git diff --check` passed.
- On the fresh tmpfs QA stack, `newgrp docker -c 'COMPOSE_PROJECT_NAME=monikey-remediation-qa COMPOSE_FILE=compose.e2e.yaml:/tmp/monikey-remediation-qa-ports.yaml PLAYWRIGHT_BASE_URL=http://localhost:18081 PLAYWRIGHT_API_BASE_URL=http://localhost:13001 npx playwright test --workers=1'` passed 26 desktop/mobile Chromium tests with 10 intentional project skips. It exercised reports month races/retry, Activity state and dedupe coverage, login and ownership, Quick Add, balanced expense/income, API process restart, and idempotent replay.
- The local authenticated review script passed 55 route/viewport checks across 360, 390, 768, 1440, and 1920px, and 110 light/dark axe scans with zero violations. It also recorded zero overflow, unnamed or undersized controls, keyboard-focus failures, page/API/console errors, network failures, or unhandled rejections in the measured routes. Reduced-motion checks passed. Selected current-worktree screenshots are in `docs/assets/remediation-review/`.
- `npm run deploy:check` was attempted but could not run: this environment has no `kustomize` executable and lacks the required cached cert-manager CRD schema location (`KUBECONFORM_EXTRA_SCHEMA_LOCATION`). No cluster or live GitOps resource was contacted. The read-only manifest review found probe paths aligned with the API. Same-host-only backups and correlated-loss risk remain as documented.
- The isolated `monikey-remediation-qa` tmpfs stack was removed after verification; the pre-existing `monikey-e2e` preview stack was left running. No GitHub Actions run, production deployment, GitOps edit, V1 resource change, or database cutover occurred. Obsidian log: [[2026-10-24 - Financial UI Reliability and Local QA]].

## 2026-10-24 — Main reliability remediation

The worktree is on `feature/main-reliability-remediation`, based on inspected `origin/main` `4f18f8ebfefed4880f9939f1e3d48cf32ff35260`; inspected `origin/dev` was `8e550546a0c75d8150bfac8309ec92923a258215`. Reports and Activity request-race handling and API readiness behavior were verified already present and were left intact. Card payment and Quick Add submission recovery, Dashboard/Accounts refresh lifecycle, and Manila date rollover were the confirmed gaps addressed in this branch. Runtime database reads use `pg`; Prisma remains schema/migration tooling with versioned SQL migrations.

Validation run against the current worktree:

- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run compose:check`, `npm run test:unit --workspace @monikey/api`, `npm run build --workspace @monikey/api`, and formatting/diff checks passed. API unit tests included Manila midnight and year-boundary cases (12 tests total).
- `npm run test:integration` passed all nine PostgreSQL-backed suites (18 tests) on isolated tmpfs PostgreSQL.
- Full one-worker Playwright run passed; `test-results/.last-run.json` reports `status: passed` and no failed tests. The suite includes payment retry, intervening Quick Add transaction, dashboard stale-response ordering, failed Accounts refresh/retry, and Manila date refresh regression cases against the actual API/PostgreSQL.
- `npm run review:local` passed 55 route/viewport checks (nine routes across five widths plus account/card detail captures) and 110 light/dark axe scans. No overflow, unnamed/undersized controls, keyboard-focus failures, API/browser errors, network failures, unhandled rejections, or WCAG 2A/2AA violations were reported. Reduced-motion checks passed. Summary output was inspected; representative current-worktree screenshots are `docs/assets/main-remediation-review/home-phone-390-light.png` and `docs/assets/main-remediation-review/home-desktop-1440-light.png`.
- `npm run deploy:check` could not execute because `KUSTOMIZE_EXTRA_SCHEMA_LOCATION`/`KUBECONFORM_EXTRA_SCHEMA_LOCATION` and the cached cert-manager CRD schema, plus local `kustomize`, are unavailable. No cluster was contacted. This is a tooling limitation, not a passing manifest validation.

The full screenshot run had one initial authentication setup error because a QA-specific user password did not match its seeded fixture; rerunning with the documented disposable `second@example.test` credentials passed. The first attempt changed no source or persistent development data. Browser runs use emulation and do not establish physical-device keyboard/safe-area acceptance.
