# Master plan coverage audit

Updated: 2026-10-23 (FIN-014 and FIN-016 regression coverage)

Owner update (2026-10-24): Dependabot update automation was removed at the
owner's request. The repository no longer has a Dependabot configuration;
open Dependabot update PRs are being closed. GitHub automated security fixes
and vulnerability alerts were already disabled.

This audit maps the approved `MONIKEY_V2_MASTER_PLAN.md` to the current V2
repository. It distinguishes implementation evidence from owner, device, and
production gates. A passing local check does not close a gate that the plan
assigns to an owner review or to the live homelab.

## Source reconciliation

The user-specified source `/home/jeysi/downloads/MONIKEY_V2_MASTER_PLAN.md`
was compared with the repository and Obsidian copy on 2026-10-23. The source
SHA-256 is `4f7e04186db50958eb3ef76a2aa207d2287ac5e14a156451a0243df8ffd0ddfe`;
the repository root and Obsidian plan copies now match the source exactly
(SHA-256 `4f7e04186db50958eb3ef76a2aa207d2287ac5e14a156451a0243df8ffd0ddfe`).
Earlier copies contained only Markdown formatting and status edits; they have
been replaced with the approved source so the source remains authoritative.

## Coverage summary

| Plan area                        | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 foundation and guardrails     | Public `Jeysibn/monikey-v2`, npm workspaces, strict TypeScript, ESLint, Compose PostgreSQL/API/web/migrate, OpenAPI contracts, high-confidence worktree/reachable-history secret scan, TruffleHog workflow pinned to its upstream SHA, grouped Dependabot, and locally built production API/web/migration images with pinned base digests and nonroot runtimes. CodeQL and per-PR full-stack checks are intentionally omitted to conserve Actions minutes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | All three local final image scans are clean for HIGH/CRITICAL; SPDX SBOMs generated locally. Branch protection was rechecked through GitHub API: `dev` and `main` enforce strict required check (`validate`). TruffleHog 3.99.4 scanned the current branch commit range locally (619 chunks, zero findings); its Actions check remains unrun. Published digests/provenance and release policy remain open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P1 UX and component system       | Blue/navy semantic tokens, light/dark themes, responsive shell, 44px target checks, reduced motion, route skeleton, an implementation-grounded mobile/desktop route-flow and low-fidelity layout draft at `docs/design/LOW_FIDELITY_FLOWS.md`, five-width Home screenshots, and light/dark 390px/1440px captures for all nine authenticated routes plus Account Detail and Card Statements; keyboard traversal and accessible Quick Add sheet. The two detail pages use real API-created disposable accounts in isolated tmpfs PostgreSQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Automated five-width review passed, including 45 route/viewport checks and 90 light/dark axe scans; physical-device, full screen-reader, human contrast walkthrough, and owner approval remain. See `docs/qa/2026-10-23/RELEASE_REVIEW.md` and the 2026-10-23 screenshot-review entry in `docs/qa/history/TESTING_HISTORY.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P2 identity and financial domain | Argon2id private bootstrap, secure sessions, CSRF/origin/rate limits, PHT dates, exact bigint minor units, balanced immutable journals, account/category lifecycle, commands, revisions, refunds, adjustments, concurrency locks, and activity queries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Backend and real-Postgres evidence complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P3 private alpha                 | Onboarding, server-backed dashboard, Activity, Accounts, PWA shell, offline write protection, privacy masking, theme persistence, Quick Add, and a real-API isolated backup/restore drill with ledger/revision checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Local alpha and restore evidence complete; owner/device sign-off and production backup scheduling/monitoring remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P4 cards and recurring bills     | Card purchases, liability and utilization, statements, partial payment allocation, correction audit, fixed/variable bills, deterministic occurrences, pay/skip, and dashboard widgets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Local API/browser evidence complete; owner/device sign-off remains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P5 reports and release polish    | Monthly reports, exact keyset-streamed CSV/JSON exports, security and category settings, full local route review, architecture audit, and one-worker Playwright acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Automated baseline complete; independent QA, full WCAG review, physical-device review, backup readiness, and owner sign-off remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P6 production replacement        | The public GitOps repository is cloned read-only at `/home/jeysi/homelab-gitops`; the V1/platform audit and local restore evidence are recorded. P6-02 includes a V2 cert-manager root/leaf chain and a documented device-trust procedure; its Ingress is isolated from default sync to protect V1 hostname ownership. P6-03 includes a SOPS/age secret generator, disposable-key round trip, and four local fail-closed/cleanup regression tests; Argo decryption integration remains unverified. P6-04 includes API/web/PostgreSQL workload templates plus default-deny and explicit-flow NetworkPolicies; the full 24-resource tree renders and passes kubeconform v1.30 locally, with cutover Ingress validated separately. P6-05 has a wave-1 pre-migration backup Sync hook before the wave-2 migration hook, with restricted local backup success/failure and migration/rerun drills, and a repeatable loopback-only upgrade verifier for fresh-empty and immediately previous-V2 schema paths; the verifier’s database URL guard is part of local validation. P6-06 has an atomic backup/rotation script, derived backup image and CronJob template tested with local PostgreSQL restore/failure scenarios. P6-07 has API metrics, chart-ready API/backup exporter scrape targets, Grafana overview, V2 namespace-correct migration/TLS rules, a read-only backup-metrics exporter, and twelve promtool-validated alerts, including journal-invariant and scheduled/pre-migration backup Job failures. P6-08 has a manual release-only GHCR workflow in the existing CI file, with required-check verification, six image scans and SBOM/digest artifacts; it has not been run. No homelab manifests, secrets, cluster changes, image publication, cutover, or V1 deletion were performed. | P6-01 repository-source audit is verified; P6-02 through P6-08 are partially implemented with local manifests/tests as documented; owner key management, device trust, live cluster checks, release publication, and promotion remain open. P6-09 now has a drafted preservation/cutover/rollback runbook grounded in V1 Git manifests at the audited SHA, but live claim identities and recovery evidence remain open. PVC capacity/object, encrypted Secret, private CA/TLS, CronJob/Kustomize live integration, exporter scrape, Alertmanager/Loki, live Calico flow checks, migration and backup hook/image/secret/compatibility gates, actual GHCR publication/digest/SBOM retention and package visibility, P6-09 V1 baseline/preservation and rollback, cutover, and V1 retention decision remain pending because no kubeconfig or cluster tooling is available and owner release gates remain open. |

## Verified product boundaries

- V2 is clean-room work. V1 is a read-only reference and no V1 application
  code, schema, data, or financial adapter is imported.
- The API derives ownership from the session for every personal query and
  mutation. Wrong-user identifiers resolve through safe not-found boundaries.
- The ledger service is the only journal-posting boundary. Posted journals and
  postings are append-only, balanced, and represented with exact PostgreSQL
  `BIGINT` values serialized as decimal strings.
- Transfers, card payments, refunds, adjustments, bill payments, retries, and
  concurrent account writes use the same database transaction and idempotency
  rules as ordinary expense/income commands.
- The PWA caches only static shell assets. Financial API responses and writes
  remain network-only; offline mode disables writes instead of queueing them.
- Scope exclusions remain enforced: no budgets, goals, investments, bank APIs,
  OCR, receipts, AI insights, notifications, imports, multiple currencies,
  split categories, tags, shared wallets, public registration, worker,
  microservices, Redis, RabbitMQ, or automatic bill posting.

## Status-glyph contrast follow-up — 2026-10-23

A code review found the `i`/`!` glyph in the informational/offline notice used
the light-theme accent color at 4.10:1 on the white preview card (3.88:1 on the
page surface), below the 4.5:1 text target. `apps/web/src/style.css` now uses
`--brand-deep` for the glyph while preserving the accent border. A rendered
390px Chromium check measured 15.59:1 in light theme and 13.35:1 in dark theme
on the notice card; the offline notice was also rendered in both themes. The
Impeccable mechanical detector returned no findings for the changed stylesheet.
This improves the local contrast evidence; manual device/screen-reader review
remains an owner gate.

## Money-precision source audit — 2026-10-23

- `packages/money/src/index.ts` parses and formats PHP minor units with `bigint`
  arithmetic, enforces the signed PostgreSQL `BIGINT` range, and serializes
  amounts as base-10 strings. It formats the whole-unit portion with
  `Intl.NumberFormat` without converting the amount to JavaScript `Number`.
- `packages/contracts/src/index.ts` validates monetary request fields as
  decimal strings and applies range/positivity checks with `BigInt`.
- Financial migrations store postings, card statements, and bill amounts as
  PostgreSQL `bigint`. Account and report aggregates cast postings to exact
  PostgreSQL `numeric`, then return text. Net cash flow uses JavaScript `BigInt`.
- The web input, display, card-utilization, and chart-width paths use the shared
  exact-money package or `BigInt` arithmetic. A source scan found no monetary
  `parseFloat`, `toFixed`, or `Number` conversions in `apps/` or `packages/`.
  Remaining numeric conversions are for dates, ports, metrics, sort order, or
  other non-monetary values.
- Existing tests cover signed `BIGINT` boundaries, values above JavaScript's
  safe-integer range, decimal-string serialization, exact reports/exports, and
  ledger balance. This source audit adds no new test result; `npm run validate`
  was the latest successful local run.

## Financial acceptance reconciliation

The 20 essential financial examples (FIN-001–FIN-020) now have explicit
test-level mappings in `docs/qa/FINANCIAL_ACCEPTANCE_MATRIX.md`. The audit aligned
FIN-001–FIN-008 fixtures with the plan's stated PHP amounts and added assertions
that pure transfers leave report totals unchanged while a transfer fee is
categorized as expense. This exposed and fixed a report defect: transfer
journals were excluded entirely, so their expense fee leg did not appear in
monthly reports. The report now reads the fee category from the current
transaction revision and counts only the expense posting; transfer principal
remains excluded. FIN-019 has both an injected second-leg PostgreSQL exception
and an actual API process-kill test during a blocked transfer posting. The
latter verifies PostgreSQL connection-loss rollback of the transaction,
journal, postings, and idempotency reservation, with both ledger-derived
balances unchanged.

The FIN-008 card-purchase refund identity was also checked against the journal
mapping. A card refund had been crediting the liability, which increases debt;
it now debits the card liability and credits the original expense category.
The PostgreSQL transaction integration test verifies the debt falls by ₱300,
monthly net expenses fall by ₱300, and a later ₱300 payment leaves the expected
remaining card debt. An authenticated Playwright journey passed against the
actual API/PostgreSQL stack and asserts the same report change. See
`docs/qa/history/TESTING_HISTORY.md` and `docs/qa/FINANCIAL_ACCEPTANCE_MATRIX.md`.

## Current local evidence

The current local database-free validation was rerun after the concurrent
idempotency changes. The latest disposable-stack finance runs used real
PostgreSQL, the actual API, the web container, and Playwright with one worker:

- `npm run typecheck` — passed.
- `npm run lint` — passed with the repository ESLint baseline.
- `npm run validate` — passed as the combined static, database-free gate.
- The combined gate explicitly runs the workspace production build in addition
  to TypeScript checks.
- `npm ci --ignore-scripts --offline` — clean lockfile install completed with zero vulnerabilities.
- `npm run build --workspace @monikey/web` — passed.
- `npm run format:check` and `git diff --check` — passed.
- Historical secret-scan evidence covered 119 tracked files. Latest validation
  scanned 129 tracked files and 1,066 reachable Git objects with no findings.
- `npm run security:secrets` scans both the worktree and reachable Git history. The high-confidence detector complements the pinned TruffleHog PR commit scan. The pinned 3.99.4 CLI also scanned the current branch commit range locally (619 chunks, zero findings); its Actions result is still pending.
- `npm run test:secret-scan` passes three disposable-repository regressions: removed historical tokens fail, uncommitted tracked-file tokens fail, matched values stay redacted, and inert local DB credentials remain accepted. It is part of `npm run validate`.
- `npm run test:full-stack` on the current worktree — 25 passed and 9 expected
  project skips across desktop Chromium and Pixel 7 emulation. The run included
  two simultaneous same-key expense retries after API restart.
- `npm run review:local` — all 18 route/viewport combinations passed in light
  and dark themes with zero axe violations, focus failures, page/API errors,
  overflow, unnamed controls, or undersized targets. API p95 was 38 ms on
  desktop and 180 ms at Pixel 7 size.
- The earlier shared PostgreSQL runner had eight suites and 17 tests and passed
  twice after the idempotency test was changed from persistent financial
  fixtures to a cleanup-safe helper-level test. The current runner has nine
  suites and 18 tests, including the actual API process-crash scenario below.
  The first version failed downstream dashboard/cursor tests by leaving
  financial records behind; the failure and correction are retained here and
  in `docs/qa/history/TESTING_HISTORY.md`.
- PostgreSQL integration, migration-upgrade, backup/isolated-restore,
  contracts, exact-money/property, and cache-header checks are recorded in
  `docs/qa/history/TESTING_HISTORY.md`, `docs/qa/2026-10-23/RELEASE_REVIEW.md`, and the architecture audit.
- `npm run backup:local` and `npm run restore:local` now automate the local
  custom-format backup/listing and isolated restore checks without storing an
  archive in the repository.
- `npm run compose:check` validates the base Compose topology and disposable
  local-test override before local or CI service startup.
- Production API, web, and migration Dockerfiles built successfully locally.
  The migration image applied all five migrations to a fresh disposable
  PostgreSQL database; the API image returned connected readiness as UID
  `node`; the web image returned the expected CSP/security headers, proxied
  API readiness, and passed five targeted desktop Playwright journeys. No
  image was published and no GitHub Actions run was started.
- Latest `npm run review:local` on the isolated stack passed all 55 route/viewport combinations (nine authenticated routes plus Account Detail and Card Statements at 360/390/768/1440/1920px) and 110 light/dark axe scans tagged for WCAG 2.0 A/AA and WCAG 2.2 AA with zero violations, keyboard focus failures, overflow, unnamed/undersized controls, page exceptions, browser console errors, unhandled promise rejections, or API errors/network failures. Reduced-motion checks passed. The gallery contains ten Home screenshots across five widths and 40 additional captures for the eight non-Home routes plus Account Detail and Card Statements at phone 390px and desktop 1440px in both themes. The two detail pages use real API-created records in the disposable tmpfs database. Screenshots and status documents are synced to Obsidian; physical-device, human screen-reader/contrast, and owner acceptance remain open. The latest rerun adds axe’s `wcag22aa` tag; it remains automated rule coverage, not a complete conformance audit.
- Historical port-isolated `compose.e2e.yaml` acceptance passed 24 Playwright
  cases with 8 expected skips and 13 PostgreSQL integration tests. The latest
  integration run passed all nine suites and 18 tests on a fresh tmpfs database.
  The latest full Playwright run also passed
  24/8 on the current worktree and included concurrent replay after an API
  restart. The test project was removed.
- Rechecked the plan's `private, no-store` requirement against actual response
  headers and found the common hook overwrote explicit export headers while
  several identity endpoints used only `no-store`. Both paths are corrected;
  Playwright asserts the directive and verifies owner/secondary-user transaction
  ID isolation in CSV and JSON. Historical acceptance passed 13 PostgreSQL tests,
  24 Playwright tests (8 expected skips), `npm run validate`, and
  `npm run compose:check`; no Actions run occurred.
- Added direct HTTP negative cases across the planned cross-user surface:
  account collection/detail/update/archive/activity, card payment and
  statement create/read/correction, bill collection/update and occurrence
  list/pay/skip, transaction collection/detail/edit/delete/audit, report totals,
  category names, sessions, and CSV/JSON export IDs. Foreign account activity
  is empty exactly as an unknown ID while direct detail returns 404. The two
  targeted desktop journeys passed against the actual API and fresh PostgreSQL;
  mobile duplicates were intentionally skipped. Comprehensive independent QA
  across every route remains open.

- Idempotency acceptance now includes an API restart followed by two concurrent
  identical real expense retries. The actual API/PostgreSQL Playwright journey
  confirms one original transaction, distinct request IDs, and unchanged
  ledger balance. A helper-level real PostgreSQL test confirms command
  execution once under concurrency, replay in a later transaction, and
  changed-payload conflict. It removes its key during cleanup.
- FIN-019-style transfer atomicity now has failure injection at the second
  PostgreSQL posting. The first source-account leg is written, the destination
  leg raises, and savepoint rollback removes all transfer rows; both balances
  remain at their exact opening values. The transaction suite passed 9/9.
  The full eight-suite/17-test runner passed twice after this regression.
- On 2026-10-23, FIN-019 gained an actual process-crash scenario: SIGKILL the
  real API while its transfer transaction is blocked in a PostgreSQL posting
  trigger. Connection loss rolled back all transfer and idempotency rows; both
  balances remained unchanged. All nine suites and 18 tests passed on a fresh
  tmpfs database, with the crash suite last to keep earlier fixtures isolated.
  The current `npm run validate` also passes locally; no Actions run was started.
- FIN-014 now has browser coverage for the actual Quick Add warning and
  explicit confirmation. The transaction integration suite verifies that the
  acknowledged negative balance posts successfully through the balanced
  ledger path. FIN-016 now creates a new card purchase after a partial payment
  and verifies the older statement's allocated and remaining due amounts do
  not change.
- FIN-001–FIN-008 now exercise the plan's exact example amounts. This also
  caught the omitted transfer-fee expense in monthly reports; a PostgreSQL
  regression now proves pure transfer totals remain unchanged and a ₱15 fee
  appears under its selected expense category.
- On a fresh tmpfs PostgreSQL/API/web stack, all eight integration suites
  passed (17 tests). Full local Playwright passed 25 tests with 9 expected
  desktop-only/mobile skips; the new negative confirmation journey passed in
  desktop Chromium. The `monikey-e2e` stack was removed afterward.
- `npm run validate` passed after the documentation and test changes: ESLint,
  strict typecheck, production build, exact-money/domain tests, formatting,
  worktree/reachable-history secret scan, scanner regressions, and npm audit
  (zero vulnerabilities). `npm run compose:check`, changed-file Prettier,
  and `git diff --check` passed; the isolated `monikey-e2e` Compose project was
  confirmed stopped.

No GitHub Actions run was started for this evidence. GitHub API checks confirmed
that both `dev` and `main` require strict `validate` only after the 2026-10-23
CI simplification; PR #59 carries this worktree. The single PR workflow runs
once per pull request. Full PostgreSQL and Playwright acceptance is run locally
against the real API and disposable database before merge.

## Completion audit and remaining gates

The implementation-status table contains all 59 unique work-package IDs from
the source plan (no missing or extra IDs). Local validation does not satisfy
the source plan's human and production acceptance requirements:

- Phase 1, P4-08, P5-06 and P5-07 still need independent human/device review,
  full WCAG/screen-reader walkthrough, and owner approval as applicable.
- P6-01's repository-source audit is now verified from a clean local checkout
  at the same SHA as remote `main`. Live cluster state remains unavailable:
  there is no kubeconfig, and `kubectl`/Argo/Helm are absent. Kustomize/kubeconform validation and a disposable local SOPS/age round trip were run; this does not provide live cluster access or an owner age key.
- P6-02 through P6-11 remain pending or partial: device-trusted TLS, Argo SOPS decryption/recovery, live Kubernetes services/policies and migration gate,
  production backup PVC/Secret/CronJob run and restore, live monitoring
  integration, published digest/provenance evidence, reviewed GitOps PR, V1
  baseline, cutover, rollback, and post-cutover retention. P6-06's executable
  and CronJob template have local evidence but no production PVC/Secret wiring. P6-09's runbook is drafted but does not claim live cluster state or a completed recovery point.
- The master plan's owner sign-off sheet remains unchecked. No phase is marked
  fully accepted from local automation alone.

## Remaining release gates

1. Owner reviews navigation and visual direction on an actual phone and
   desktop, including screen reader, contrast, focus, reduced motion, and
   touch behavior.
2. Owner accepts the local backup/restore evidence and the same-host backup
   risk before real financial use.
3. The authoritative homelab checkout and live cluster conventions are
   inspected before promoting the backup template or writing/applying the
   remaining service, secret, migration, monitoring, or TLS resources.
4. Image publication, digest traceability, GitOps promotion, cutover, rollback,
   and V1 resource retention require a separate owner-approved release.

### Recovery verification update — 2026-10-23

- `restore:local` now verifies applied migrations, at least two balanced postings per journal, current transaction revisions, and journal presence for every posted transaction. `BACKUP_DATABASE` allows an isolated E2E source database, and backup paths are rejected if their canonical/symlink-resolved location is inside the repository.
- A fresh tmpfs stack used the real API to create a disposable opening-balance account and expense, then passed backup/list/isolated restore checks (1 user, 1 account, 2 transactions, 2 journals, 4 postings, 2 revisions). Path-negative checks and the final repeat drill passed; test archive and restore DB were removed. The production backup package now has local container/rotation/restore evidence; production PVC/Secret wiring and live restore acceptance remain pending.
- Added 30-run generated PostgreSQL negative properties for each of foreign/archived/missing account and category references. All generated transaction requests failed safely before posting; the transaction/dashboard integration suite passed seven tests.

### Activity pagination scale review — 2026-10-23

- Added a separately invoked Playwright scale review and guarded disposable-data seeder. On fresh tmpfs Docker stacks, the actual API returned 10,000 unique transactions in 100 cursor pages (3,953–4,343 ms total, 16–23 ms p95/page); the UI rendered the initial 25 rows and the next 25 on demand. `EXPLAIN ANALYZE` selected `transactions_owner_activity_idx`; the first 101-row page took 0.54–0.94 ms.
- The review exposed timestamp precision loss in cursors because JavaScript `Date` removes PostgreSQL microseconds. Cursors now retain exact database timestamp text; a real PostgreSQL integration regression verifies tied timestamps do not cause skipped or duplicated entries. The public activity timestamp remains ISO formatted.
- The scale fixture writes every balanced journal and posting through the sole ledger service, and its 10,000 rows existed only in the disposable tmpfs database, removed after the run. This local development sample is not the production/homelab performance acceptance gate.
- Reviewing the scale fixture found that revisions named a different source account from the account used by journal postings. The seeder now uses one account for both, and Playwright asserts its ledger-derived balance after the 10,000 expenses. The corrected current-worktree rerun on 2026-10-23 returned 10,000 unique entries in 100 pages against the actual API and tmpfs PostgreSQL: 5,022 ms total and 33 ms page p95. Activity rendered its first 25 rows and then 50 after loading more; a second user saw an empty activity list and no scale account. The isolated stack was removed; representative homelab hardware remains unmeasured.
- The scale-seed guard now requires test mode, explicit opt-in, `monikey_e2e`, and a Docker/loopback host. A remote database URL with the expected database name was rejected before connection; API typecheck passed.

- Transaction response contract follow-up: aligned successful income, expense, refund, adjustment, transfer, and edit responses with §7.3 by adding the current `requestId`. A clean real-API Playwright financial journey verified request IDs for create, replay, transfer, transfer replay, and edit; OpenAPI generation/check passed against the local API. `npm run validate` passed. No Actions run was started.
- Full regression follow-up on a new tmpfs stack: all 15 PostgreSQL integration tests and 24 Playwright cases passed (8 expected mobile project skips), including the request-ID assertions. OpenAPI contract check, full local `npm run validate`, Compose validation, and diff whitespace check passed. The stack was removed; Actions were not used.

### Transaction success traceability — 2026-10-23

- Master-plan §7.3 requires successful expense responses to include the request ID, server-authoritative balance, effective transaction date, revision, and transaction ID. The shared transaction response schema now requires `requestId`; create/edit and transfer handlers attach the current HTTP request ID after idempotency resolution so replay traces remain specific to the current request.
- Real-API Playwright assertions cover the expense result and idempotent replay. OpenAPI declarations are regenerated/checked from the live local API during validation.

### Concurrent idempotency after API restart — 2026-10-23

- The financial Playwright journey commits an expense, restarts the isolated API
  container, waits for readiness, and submits two concurrent retries with the
  original request and key. Both responses return the committed transaction
  with distinct request IDs; account balance remains unchanged.
- A PostgreSQL integration suite verifies concurrent helper calls execute the
  command once, then checks committed replay and changed-payload conflict in a
  later transaction. It removes its idempotency row during cleanup.
- The full eight-suite integration runner passed twice on the same tmpfs DB
  (16 tests each). An earlier version with committed financial fixtures
  polluted later tests and failed; after replacing it with cleanup-safe helper
  coverage, both full runs passed. The targeted desktop Playwright journey also
  passed. The temporary Compose project was removed; no GitHub Actions run was
  started.

### Application metrics and monitoring package — 2026-10-23

- Added a private Prometheus `/metrics` endpoint with bounded method/route/status
  labels, request counters, latency histograms, and a live PostgreSQL probe.
  User/resource IDs, query values, request IDs, and financial fields are not
  labels. Unit checks cover histogram buckets and identifier/query redaction.
- Real API/PostgreSQL Playwright acceptance passed on desktop Chromium and
  Pixel 7 emulation; both verified DB-connected output and safe route labels.
- Added a Grafana overview and ten alert rules for API scrape/DB state,
  elevated server errors/latency, backup freshness/failure/storage, migration
  failure, and TLS expiry. YAML and dashboard JSON parse locally. The audited
  upstream Prometheus currently has Alertmanager disabled, and no PromQL binary
  validation or live scrape/routing check has run.
- Backup/Kubernetes exporter metrics and selectors remain declared integration
  contracts, not live telemetry. At the time of this review, the ledger-invariant alert remained unconfigured
  pending a dedicated counter; the 2026-10-23 follow-up below implements and
  locally validates that signal and alert. Loki
  structured log shipping is also still a homelab integration gate.
- No homelab repository or cluster changes were made; no Actions run occurred.

### Journal-invariant monitoring follow-up — 2026-10-23

- Implemented the plan's missing ledger-invariant signal: the app increments a
  label-free counter for unbalanced posting validation failures, and the API
  transaction boundary recognizes PostgreSQL's deferred balanced-journal
  constraint error. No journal/user identifiers become metric labels.
- Added a critical Prometheus alert on any counter increase within ten minutes
  and a Grafana panel displaying the same ten-minute count.
  `npm run validate` passed; Prometheus 3.5.0 `promtool` accepted all eleven
  alert rules, and `promtool test rules` verified the journal-invariant rule
  stays quiet at zero and fires following a counter increase. All nine
  real-PostgreSQL integration suites passed (18 tests), including an assertion
  that only the unbalanced journal attempt increments the counter.
- Live scrape reachability, alert delivery through Alertmanager, and Loki
  ingestion still require live homelab and owner-authorized validation.

### Backup timezone source check — 2026-10-23

The audited homelab GitOps source at `2369afce6161f8c3f3f970cf1e484e44b3227df9` has an install script specifying K3s `v1.36.3+k3s1`, compatible with the CronJob `timeZone` field. This is repository configuration only; no kubeconfig or live version evidence is available. The backup CronJob now explicitly schedules 02:00 `Etc/UTC`. Its PVC, Secret, database service, exporter scrape, live execution, and restore gates remain open.

### Backup restricted-runtime acceptance — 2026-10-23

The current backup image was run as UID/GID 70 with a read-only root filesystem, all capabilities dropped, and `no-new-privileges` against disposable tmpfs PostgreSQL. The archive passed `pg_restore --list` and successful metrics were emitted. A controlled unreachable-host failure exited nonzero, changed the last-run metric to failure, and preserved the prior success timestamp and archive. This improves P6-06 image/script evidence; live PVC mounting, storage capacity, Secret/network wiring, scheduled execution, monitoring, and production restore remain open.

### Backup-metrics semantic validation — 2026-10-23

The P6-07 read-only exporter now rejects impossible metric combinations: success must be 0/1, timestamp and byte metrics must be integers, available bytes cannot exceed total volume size, and a successful backup requires a nonzero timestamp and archive size. Four unit tests and the full database-free validation gate passed. A rebuilt restricted container exposed valid metrics and suppressed data series for an invalid success value. Live Prometheus scrape and alert delivery remain open.

### Backup alert-rule timing tests — 2026-10-23

Prometheus 3.5.0 `promtool` validates all twelve alert rules. Its checked-in test fixture now verifies the journal invariant and recent-success quiet behavior plus backup overdue/absent, failed run, invalid telemetry, low-volume-space, and failed scheduled/pre-migration backup Job alerts before and after their configured pending windows. This adds local P6-07 rule behavior evidence; live scrape, Alertmanager delivery, and Loki ingestion remain unverified.

### Release digest-manifest guard — 2026-10-23

P6-08 now has a local fail-closed check for release artifact completeness. It matches `source_commit` to the dispatched SHA, records and verifies `migration_schema_version` against the latest timestamped Prisma migration directory in the source, matches PR number/head to the earlier verified PR outputs, and requires exactly the six expected `ghcr.io/<owner>/monikey-v2-*` repositories with immutable SHA-256 digests. Six manifest tests cover complete, missing, duplicate, mutable-tag, wrong-repository, malformed-digest, mismatched-commit/schema-version, and invalid-metadata cases; two helper tests cover migration discovery and PostgreSQL provider validation; four renderer tests cover image transform construction, seven exact workload references across six digest identities, clean source-checkout enforcement, and Git-worktree output-path rejection. The opt-in publication job invokes the guard after all six scan/SBOM iterations succeed and before artifact retention. `scripts/release/render-release-manifests.mjs` supports a local promotion handoff: it verifies a retained manifest, renders a temporary Kustomize copy with six immutable pins across seven workload image references, requires a clean checkout at the release source commit, refuses extra/placeholder images and output paths inside Git worktrees, and writes an explicitly chosen candidate path. A synthetic clean Git source with six test digests rendered 24 resources that passed strict kubeconform validation. This does not publish images or close GHCR visibility, provenance, Actions, or GitOps promotion gates.

### Concurrent bill-payment retry acceptance — 2026-10-23

P4-08 retry acceptance now also includes concurrent bill payment at the API
boundary: two simultaneous same-key requests return the same canonical paid
occurrence and linked expense, while a fresh-key attempt against the paid
occurrence returns HTTP 409 and does not debit the funding account again. The
targeted desktop Playwright journey passed against a fresh tmpfs PostgreSQL
stack. Owner device review and Phase 4 sign-off remain open.

The same API journey races two different statement payment requests of
₱40,000 while ₱70,000 remains due. One payment succeeds, the competing payment
returns HTTP 409, and the saved allocation and funding-account balance show
exactly one debit. This verifies the statement row lock protects the manual
issuer balance from concurrent over-allocation.

The P5-06 responsive review now verifies reduced motion on the app's actual
`.skeleton-line` animation and `.amount-control` transition classes, rather
than checking only the body element. All five viewport widths produced 0.01ms
animation/transition durations and a single animation iteration. The full
45-route/viewport matrix and 90 light/dark axe scans passed against the actual
API and tmpfs PostgreSQL. Human screen-reader, physical-device, contrast, and
owner review remain open.
