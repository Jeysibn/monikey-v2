# Changelog

## 2026-10-24 — Organize repository documentation and tooling

- Grouped current development and release guides separately from dated QA reports.
- Added documentation, QA, and script indexes with explicit placement conventions.
- Kept the complete testing history while extracting a current testing guide and fixture setup.
- Colocated review screenshots with their dated QA evidence; retained all assets.
- Grouped scripts by checks, database, release, security, testing, and assets; updated npm, CI, imports, root resolution, and documentation paths.
- Preserved the existing financial implementation, schema migration history, and application behavior.
- Validation: `npm run validate`, Compose checks, live API contract parity, and the relocated PostgreSQL migration-upgrade command passed. Local Markdown links and relative script imports resolve; 79 relocated screenshots retain their Git contents and 87 application/schema/test files match the cleanup baseline. Kubernetes schema validation remains blocked by unavailable local cert-manager schemas/tools.

## 2026-10-24 — Correct linked card and bill history, confirmations, and retries

- Voiding a card payment now reverses its statement allocation atomically; bill
  payment edits and voids update the linked occurrence and append payment
  history in the same ledger transaction.
- Bill schedule edits reconcile unpaid current/future occurrences under a rule
  lock while retaining paid/skipped occurrences. Calendar dates and requested
  occurrence windows are validated and capped at 366 days. Bills and dashboard
  reads hold the rule lock through occurrence generation and result materialization,
  so concurrent schedule changes cannot leave stale due dates.
- Card credit creation now has a dedicated acknowledgement across card
  payments, refunds, adjustments, expense edits, and reversal paths. Bill
  overdraft confirmation displays the exact submitted amount. Combined
  overdraft/card-credit approvals are retained independently; transaction
  edit and reversal confirmations show exact named account projections and
  include income source-account reversals.
- Bill edit/status/archive/restore actions now retain pending/error state, and
  bill, opening-balance account, and statement create forms preserve idempotency
  keys for unresolved requests. Calendar-date validation and field-level HTTP
  errors cover bill occurrence, Activity, and CSV export query filters.
  Generated OpenAPI declarations reflect the changed request contracts.
- Migration `20261024000000_linked_corrections_and_occurrences` records
  allocation reversals and bill occurrence payment history.

## 2026-10-23 — Re-run full current-worktree financial acceptance

- Rebuilt the isolated tmpfs PostgreSQL/API/web stack and passed all nine
  PostgreSQL suites (18 tests) plus one-worker desktop/mobile Playwright
  (25 passed, 9 intentional skips). Coverage included streamed owner-scoped
  CSV/JSON exports and process-kill transfer rollback.
- Removed the isolated stack; the existing development API remained ready.
  No GitHub Actions, image publication, GitOps change, or deployment occurred.

## 2026-10-23 — Validate CI workflow and publisher gates locally

- Added a YAML parser and structural guard for the PR-only validation workflow
  and explicitly opted-in main image publisher. Nine regression tests reject
  trigger duplication, missing PostgreSQL/Playwright runs, wrong publish branch,
  excess permissions, publication before local scans, and malformed YAML.
- Added both checks to `npm run validate`, so local and PR validation cover
  workflow structure without dispatching a GitHub Actions run.

## 2026-10-23 — Stream owner-scoped financial exports

- CSV and JSON export routes now stream current transaction revisions through
  bounded keyset pages under a consistent read-only database snapshot instead
  of building the full transaction result in memory.
- Kept owner scoping, exact amount strings, formula-safe CSV, export schema and
  private/no-store headers. PostgreSQL page-size-one integration and actual API
  Playwright export checks passed; lint and typecheck passed locally.

## 2026-10-23 — Complete Chromium-sized PWA install icons

- Added reproducible 180px Apple touch, 192px, and 512px PNG assets from the
  existing SVG icon. The manifest declares the install sizes and the HTML links
  the Apple touch icon; the service worker caches the static icons.
- Expanded PWA Playwright coverage to verify manifest declarations, fetched PNG
  signatures/dimensions, and network-only API behavior. The targeted real
  browser journey passed against both development web and production Nginx
  images connected to actual disposable API/PostgreSQL. `npm run validate`
  passed locally. Device installation acceptance remains open.

## 2026-10-23 — Add repeatable Kubernetes manifest schema check

- Added `npm run deploy:check` to render the Phase 6 Kustomize root and strictly
  validate it and the separate cutover Ingress against Kubernetes 1.30 plus
  local cert-manager schemas. The current run accepted all 25 resources.
- `npm run validate` passed locally after the addition. The gate checks
  manifests only; live cluster and release gates remain open.

## 2026-10-23 — Keep the approved plan source authoritative

- Restored the repository and Obsidian plan copies byte-for-byte from the user-supplied master plan. Current implementation status remains in `docs/development/IMPLEMENTATION_STATUS.md`.
- Added the fresh actual-API backup/restore recheck and cleanup evidence to the P6-06 implementation status row. Production gates remain open.

## 2026-10-23 — Recheck current-worktree backup restore

- Seeded one disposable owner, account, and expense through the actual API on fresh tmpfs PostgreSQL. A 73,118-byte custom-format archive passed `pg_restore --list` and restored into a separate database with balanced journals, current revisions, and two transactions verified.
- Removed the temporary restore database, stack, archive, and seed script. The persistent development database and production backup gates were not involved.

## 2026-10-23 — Keep scale-review finance fixtures consistent

- Corrected the 10K scale seeder so each transaction revision and its balanced journal use the same financial account.
- Added Playwright assertions for the account's ledger-derived `-10000` minor-unit balance and second-user isolation after 10,000 one-minor-unit expenses. The corrected local review passed against the actual API and tmpfs PostgreSQL: 10,000 unique entries in 100 pages, 5,022 ms total, and 33 ms API page p95. The disposable stack was removed.

## 2026-10-23 — Reconcile architecture notes with implemented product

- Replaced stale foundation-scaffold status with the current application and release-gate state in the architecture context, financial schema, ledger service, category lifecycle, and design system notes.
- The Obsidian project vault now contains the matching architecture notes and links them from its Docs index. Owner/device acceptance and live Phase 6 gates remain explicitly open.

## 2026-10-23 — Test secret bootstrap failure boundaries

- Hardened the generator to suppress SOPS stderr and report only its exit status, preventing subprocess diagnostics from reaching logs. A regression test emits a sentinel on stderr and confirms it is not exposed.

- Added four local process-level regression tests for age-recipient validation,
  ciphertext overwrite protection, restrictive plaintext/output permissions,
  and temporary plaintext cleanup after SOPS success or failure.
- Tests use a fake SOPS executable and create no age key or real secret. The
  separate disposable-key encryption round trip remains the cryptographic
  implementation evidence; live Argo decryption remains unverified.

## 2026-10-23 — Alert on backup Job failures

- Added a critical Kubernetes Job-state alert for both scheduled backup Jobs
  and the pre-migration backup hook. A failed lock contender is now observable
  even if another backup succeeds and publishes healthy file metrics.
- Added quiet/firing Prometheus rule cases for both generated Job name forms.
  Prometheus 3.5.0 `promtool` accepted and tested all 12 rules. Live metric
  availability and Alertmanager delivery remain unverified.

## 2026-10-23 — Serialize backup jobs sharing the PVC

- Added a nonblocking `flock` before backup state/metrics access so CronJob and
  pre-migration hook cannot race snapshot publication or retention. The backup
  image build checks that `flock` is available.
- A concurrent restricted container exited 75 with `already_running`; after
  killing the holder, a PostgreSQL backup succeeded and the disposable volume
  was removed. No production PVC or Actions run was used.

## 2026-10-23 — Gate schema migration on a validated backup

- Added an Argo CD Sync-hook backup Job at wave 1 before the migration hook at
  wave 2; API/web run at waves 3/4. The backup hook reuses the scheduled
  backup image, Secret, PVC, and restricted runtime.
- The isolated PostgreSQL runtime smoke succeeded with UID 70 and read-only
  root/no capabilities; a bad-password attempt exited nonzero. Updated local
  release rendering to verify seven workload references across six digest
  pinned image identities. Argo behavior remains unverified; no Actions run.

## 2026-10-23 — Render a verified release manifest for review

- Added `npm run render:release-manifests` to validate a retained six-image release artifact and generate a Kustomize-rendered candidate with all workload images pinned by digest. It checks source commit/PR/schema metadata, refuses missing or extra image references, renders from a temporary copy, and creates only a new caller-selected output file.
- Twelve local release-manifest/schema/render tests passed. A synthetic clean Git source with a six-digest manifest rendered 23 resources, found exactly six image pins, and passed strict kubeconform validation against Kubernetes 1.30 plus cert-manager schemas. No actual release artifact, GitOps checkout, cluster, or GitHub Actions run was used.

## 2026-10-23 — Record migration schema version in release evidence

- Added `migration_schema_version` to the six-image release manifest. The value comes from the latest timestamped PostgreSQL migration directory in the checked-out source, and the release guard rejects missing or mismatched values.
- Added migration discovery and provider tests; release-manifest coverage now includes schema mismatch rejection. The manual publisher still requires a verified `main` PR and explicit dispatch; no publication or Actions run occurred.

## 2026-10-23 — Refresh responsive accessibility review

- Ran `npm run review:local` against the current worktree in a fresh isolated Docker stack. All 45 route/viewport checks and 90 light/dark axe scans passed; reduced-motion, focus, overflow, target-size, and browser/API checks reported no findings.
- Removed the isolated stack. Physical-device, screen-reader, independent QA, and owner acceptance remain pending.

## 2026-10-23 — Re-run local PostgreSQL and browser acceptance

- Rebuilt the isolated E2E stack from the current worktree and ran all nine PostgreSQL integration suites against the actual API and tmpfs database (18 tests passed), followed by Playwright (25 passed, 9 expected mobile-project skips).
- `npm run validate` and `npm run compose:check` passed locally. The separate rollback-only `prisma/tests/financial_schema.sql` contract passed against a fresh tmpfs database. Both isolated projects were removed; no GitHub Actions run or production operation occurred.

## 2026-10-23 — Reconcile Phase 6 deployment notes

- Updated the cutover inventory to require all six release image digests (web, API, migration, PostgreSQL, backup, and backup-metrics).
- Reconciled the Kubernetes migration gate with the checked-in PostgreSQL, migration, API, and web workload templates and the 23-resource schema-validated root. Local manifest validation does not establish live Argo behavior or authorize promotion.
- Synced the current deployment notes and evidence to the Obsidian project vault. No cluster resources, GitOps repository, secrets, or release artifacts were changed.

## 2026-10-23 — Verify the completed image digest manifest

- Added a local release-manifest guard that requires the release source SHA, validated PR metadata, and exactly six canonical GHCR image repositories pinned to immutable SHA-256 digests. It rejects missing or duplicate images, mutable tags, wrong repositories, malformed digests, source mismatches, and invalid PR metadata.
- Added five regression tests and included them in `npm run validate`; the guard now compares the manifest PR number and head to the earlier PR verifier outputs. The manual publication workflow runs the guard only after all six image scans and SBOMs succeed, before retaining the artifact. No Actions run or image publication occurred.

## 2026-10-23 — Test backup alert windows with promtool

- Extended `monikey-alerts.test.yml` beyond the journal invariant to cover stale and absent backup timestamps, failed runs, invalid backup metrics, and low backup-volume space, including each rule's grace period and expected alert metadata.
- Added a fresh-success case confirming a current backup timestamp does not trigger the overdue rule.
- Prometheus 3.5.0 `promtool check rules` accepted all eleven rules, and `promtool test rules` passed the expanded fixture. The absent-series test confirmed Prometheus retains the `job` equality matcher on the synthetic alert series.

## 2026-10-23 — Reject semantically invalid backup metrics

- The read-only backup-metrics exporter now requires binary run status, integer timestamps and byte counts, available bytes no greater than total volume size, and nonzero timestamp/archive size when success is reported. Invalid files suppress the backup data series.
- Four unit tests passed. A rebuilt restricted container returned valid metrics for a valid file and `metrics_file_valid 0` with no backup series for an impossible success status. Full `npm run validate` passed; no Actions run or cluster change occurred.

## 2026-10-23 — Validate backup under Kubernetes runtime restrictions

- Ran the derived backup image as UID 70 with read-only root, all capabilities dropped, and no-new-privileges against disposable tmpfs PostgreSQL. The archive passed `pg_restore --list` and success metrics were recorded.
- Forced a database DNS failure under the same restrictions; the container failed, marked the latest run unsuccessful, and preserved the prior good archive and success timestamp. The test volume and database were removed; no Actions or cluster resources were used.

## 2026-10-23 — Pin backup schedule to UTC

- Added `timeZone: Etc/UTC` to the production backup CronJob so the 02:00 schedule aligns with UTC backup IDs and freshness timestamps even if the cluster controller uses another local timezone.
- Kustomize rendered the full 23-resource tree and kubeconform validated it against Kubernetes v1.30 and the cached cert-manager schemas. No cluster changes were made.

## 2026-10-23 — Improve notice-glyph contrast

- Changed informational and offline notice glyphs to the existing high-contrast
  `--brand-deep` token; kept the accent-color outline for the non-text cue.
- Rendered both notices at a 390px viewport in light and dark themes. The preview
  glyph measured 15.59:1 on the light card and 13.35:1 on the dark card. The
  Impeccable detector reported no findings for the changed stylesheet.

## 2026-10-23 — Isolate process-crash integration fixtures

- FIN-019 now uses a dedicated disposable `crash@example.test` user so its
  retained archived-account fixtures do not contaminate the E2E owner or
  secondary-user checks. CI and the local setup instructions seed this user.
- Verified the CI suite order locally against one fresh tmpfs PostgreSQL
  database: all nine integration suites passed (18 tests), then Playwright
  passed 25 tests with 9 expected skips. `npm run validate` passed. No Actions
  run was started; only the isolated E2E stack was removed, and the development
  services remained healthy.

## 2026-10-23 — Alert on journal-balance invariant failures

- Added the label-free `monikey_ledger_invariant_failures_total` API counter for
  app-side unbalanced journal validation and PostgreSQL deferred journal-balance
  constraint failures. No account, user, journal, request, or monetary labels are
  exported.
- Added `MoniKeyLedgerInvariantFailure`, a critical Prometheus rule that fires
  when the counter increases in ten minutes, plus a red-threshold Grafana stat
  panel showing the ten-minute failure count. Unit tests cover app/database
  error classification, PostgreSQL integration verifies the ledger service
  increments only for an unbalanced journal, Playwright checks the actual API
  exposition, and `promtool check rules` plus a rule-behavior fixture validate
  the rules.
- `npm run validate` passed. All nine PostgreSQL integration suites passed (18
  tests), the one-worker Playwright run passed 25 tests with 9 expected skips,
  and Prometheus 3.5.0 `promtool` accepted all eleven rules. No Actions run or
  homelab change occurred. Live scrape and Alertmanager delivery remain open.

## 2026-10-23 — Add opt-in GHCR image release path

- Extended the existing single CI workflow with a manual-only dispatch job;
  pull-request validation remains the only automatic trigger and runs once per
  PR. Publication requires selecting `main` and explicitly setting
  `publish_images=true`.
- Added a release guard that resolves the `main` merge commit to its merged PR
  and requires the latest `validate`, `e2e`, and `CodeQL` checks on that PR head
  to be successful. The guard passed locally for current `main` commit
  `bf11edfea342adef253ce6ccd21a98aec95e3790` and PR #57.
- The manual job builds SHA-tagged API, web, migration, and backup images;
  scans all findings at HIGH/CRITICAL before publishing and scans each pulled
  registry digest again; it retains a digest map, per-digest Trivy JSON reports,
  and SPDX SBOMs as a 90-day workflow artifact. No Actions run was started; the
  workflow has not published images. GHCR visibility/provenance and GitOps
  promotion remain separate.

## 2026-10-23 — Add fail-closed migration Job template

- Added a Kustomize Job using an Argo CD Sync hook at wave 1, after the future
  PostgreSQL wave 0 and before API/web wave 2. It has zero retries, a 15-minute
  deadline, a non-root/read-only/no-capabilities pod context, and reads
  `DATABASE_URL` from the future encrypted runtime Secret.
- Rebuilt and ran the migration image twice against fresh disposable PostgreSQL
  17.11 under UID 1000, read-only root, `/tmp` tmpfs, no-new-privileges, and no
  capabilities. The first run applied five migrations; the second found none
  pending and the database retained five successful migration records.
- The Job image remains an explicit GHCR digest placeholder. Argo wave behavior,
  actual workloads/Secret, resource sizing, and migration rollback compatibility
  remain unverified. Trivy 0.76.0 found zero HIGH/CRITICAL findings in the
  local image, and Syft 1.33.0 generated an SPDX 2.3 SBOM with 160 packages.
  No cluster or GitOps change was made.

## 2026-10-23 — Add default-deny V2 network policy package

- Added a Kustomize package for default-deny ingress/egress and explicit
  Traefik-to-web, web-to-API, API/migration/backup-to-PostgreSQL, monitoring
  scrape, and CoreDNS flows in the `monikey-v2` namespace.
- Kustomize v5.7.1 rendered seven policies; kubeconform v0.6.7 validated all
  seven against Kubernetes v1.30. A Node/YAML semantic check verified default
  deny, DNS, peer selectors, and application ports. Prettier plus
  `git diff --check` passed. Live Calico enforcement, namespace/label
  confirmation, workload manifests, and in-cluster flow checks remain open.
  No GitOps repo was edited or applied.

## 2026-10-23 — Refresh local validation without Actions

- Ran `npm run validate` locally against the current worktree. Lint, types,
  builds, exact-money and finance invariants, formatting, secret scanning, and
  dependency audit passed; `npm audit` found zero vulnerabilities.
- Ran `npm run compose:check` successfully for the development, local-test,
  and isolated E2E Compose configurations. No Actions run or services started.

## 2026-10-23 — Phase 6 observability groundwork

- Added a private Prometheus metrics endpoint with bounded route/method/status labels, request counters, latency histograms, and PostgreSQL scrape health. No user, resource, request, or financial values are exported as labels.
- Added an importable Grafana overview and nine Prometheus alert rules. `promtool` 3.5.0 validated all nine rules; real API/PostgreSQL Playwright checks passed on desktop Chromium and Pixel 7 emulation.
- Hardened low-volume error/latency alerts with a request-count floor, and made stale-backup alerting detect a never-seen success metric. Removed a stale README claim about a ledger-invariant alert that is not implemented.
- Recorded P6-07 as partially implemented. Live scrape policy, exporter/cluster labels, Alertmanager, backup/migration telemetry wiring, Loki ingestion, and owner-reviewed GitOps integration remain open. No Actions run or homelab change occurred.

## 2026-10-23 — Implement local PostgreSQL backup rotation and CronJob template

- Added the atomic custom-format archive publication, SHA-256 and `pg_restore --list` validation, seven daily/four weekly retention, hard-linked weekly snapshots, and a redacted Prometheus textfile metrics output.
- Rebuilt the local backup image on pinned PostgreSQL 17.11 / Alpine 3.24.3, removed the unused upstream `gosu` executable, and verified that Trivy 0.76.0 reports zero HIGH/CRITICAL findings. The upstream image still has 26 such findings in `gosu`; the CronJob's immutable registry image digest must be updated after publishing the derived image from validated `main`.
- Added a restricted daily Kustomize/CronJob template referencing a future dedicated backup PVC and encrypted DB-client Secret. Kustomize v5.7.1 rendered it; kubeconform v0.6.7 validated the two objects against Kubernetes v1.30 schemas.
- Local Docker tested eight real database dumps, daily/weekly rotation, checksum, forced database failure preserving seven good backups, and isolated restore of disposable finance data (3 users, 7 transactions, 10 journals, 21 postings, 9 revisions). The test volume and E2E stack were removed.
- P6-06 remains partial until the owner-measured PVC, encrypted Secret, namespace/network/exporter wiring, and live restore drill are verified. No homelab change or GitHub Actions run occurred.

## 2026-10-23 — Reproduce the homelab source audit locally

- Cloned `Jeysibn/homelab-gitops` read-only to `/home/jeysi/homelab-gitops`. The clean checkout and remote `main` both resolve to `2369afce6161f8c3f3f970cf1e484e44b3227df9`; reviewed the Argo registry, legacy MoniKey manifests, cert issuer, Longhorn storage, and monitoring values.
- Updated the Phase 6 audit to mark only the repository-source portion of P6-01 verified. No kubeconfig or cluster tools are available, so live state, manifests, deployment, and all cutover gates remain pending. The homelab checkout was not modified.

## 2026-10-23 — Verify atomic rollback after a transfer posting failure

- Added a real-PostgreSQL failure-injection integration test. A transaction-scoped trigger rejects the transfer's second posting after the first leg has been written; rollback removes the transaction, revision, journal, first posting, audit events, and reserved idempotency key. Both ledger-derived account balances remain unchanged.
- The transaction/dashboard integration suite passed 9/9. The complete eight-suite runner passed twice on the same tmpfs database with 17 tests per run, confirming no fixture leakage. `npm run validate`, `npm run compose:check`, and `git diff --check` passed after the test and documentation changes. No GitHub Actions run was started.

## 2026-10-23 — Verify concurrent transaction replay across API restart

- Extended the real-API expense idempotency Playwright journey to restart the disposable API container after commit, wait for readiness, then submit two simultaneous identical retries. Both responses resolve to the committed transaction, each carries its own request ID, and the ledger balance remains unchanged.
- Added a PostgreSQL idempotency integration suite for concurrent helper calls, durable replay, and payload-mismatch rejection. Its key row is removed during cleanup. An initial persistent finance fixture polluted later tests; after replacing it with cleanup-safe helper coverage, the full eight-suite runner passed twice against the same tmpfs DB (16 tests per run before the subsequent rollback regression was added).
- Full local Playwright against the current worktree passed 24 tests with 8 expected project skips across desktop Chromium and Pixel 7 emulation. This included the API restart/concurrent replay journey. The tmpfs stack was removed; no Actions run was started.

## 2026-10-23 — Add regression tests for secret scanning

- Added three temporary-Git-repository tests for removed historical tokens, uncommitted tracked-file tokens, redacted output, and inert local database placeholders. `npm run validate` now runs this suite after the current worktree/history scan.
- The focused scanner suite passed 3/3; full `npm run validate` passed with 129 tracked files, 1,066 reachable Git objects, and zero npm audit vulnerabilities.

## 2026-10-23 — Add pinned TruffleHog PR secret verification

- Added the official TruffleHog GitHub Action to the existing `validate` job, pinned the action to the verified v3.99.4 commit and the scanner image version to 3.99.4. It scans PR commits and fails on detected secrets.
- No extra workflow/job or trigger was added. The check is configured but awaits the next normal PR run; no Actions run was started. The local high-confidence history scan remains part of `npm run validate`.

## 2026-10-23 — Scan reachable Git history for high-confidence secrets

- Extended `security:secrets` to inspect both tracked worktree files and text blobs reachable from local Git refs. Findings identify only a path and detector name, never print the matched value. Existing local/test placeholders remain exempt.
- The PR validation checkout now fetches complete Git history, allowing this scan to inspect prior reachable commits. Local verification scanned 129 tracked files and 1,066 reachable Git objects with no findings.
- The separate TruffleHog verified-scan gate is now configured in the existing PR job; its first result is pending.

## 2026-10-23 — Pin GitHub Actions to release commits

- Pinned checkout v4.2.2, setup-node v4.4.0, and CodeQL v3.29.11 to the commit SHAs verified from their upstream GitHub refs, following the master plan's workflow supply-chain requirement.
- Workflow YAML parsing and formatting pass locally. No GitHub Actions run was started; GHCR publication and release provenance remain open.

## 2026-10-23 — Complete PostgreSQL suite in the single PR E2E job

- Replaced four individually invoked database suites in the existing PR E2E job with one call to the canonical `npm run test:integration` runner. The job still performs OpenAPI and database schema checks, and now also runs card, bill, and report integration coverage.
- Verified locally against the isolated tmpfs Docker stack: schema constraints passed and rolled back; all 15 API integration tests passed across seven suites. The stack was removed. No GitHub Actions run was started.
- GHCR publication, published-image digest scans, retained SBOM/provenance, device/owner acceptance, and Phase 6 remain open.

## 2026-10-23 — Master-plan status reconciliation

- Compared the implementation-status package IDs and titles with the source master plan. All 59 work-package IDs are present; corrected the P5 numbering to match the source and restored the P5-02 report-chart/accessibility deliverable.
- Removed stale P1 descriptions that implied authenticated routes and financial writes were still absent after Phases 2–3. Updated current five-width and 10K-list evidence and rechecked Phase 6 local tool/checkout availability.
- The 10K fixture now also rejects nonlocal database hosts even when the database name and test opt-in match. A remote-host URL was refused before opening a connection; API typecheck passed.

## 2026-10-23 — Request IDs on transaction success responses

- Aligned transaction create, transfer, and edit responses with master-plan §7.3 by returning the current HTTP request ID alongside the transaction and server-authoritative account balances. Idempotent replay returns its own request ID while preserving the original transaction result.
- Updated the shared Zod/OpenAPI response contracts and documented the behavior in the transaction architecture notes. A real-API Playwright assertion covers both the initial expense and replay.
- On a fresh disposable Docker stack, all 15 PostgreSQL integration tests and the full Playwright suite passed (24 passed, 8 expected mobile-project skips); OpenAPI contract check and `npm run validate` passed. The stack was removed and no GitHub Actions run was started.

## 2026-10-23 — Cross-user IDOR coverage

- Added Playwright checks for cross-user account reads/updates/archive/activity, card payments and statements, bill listing/update/occurrence pay/skip, transaction list/detail/edit/delete/audit, reports, and category names, alongside export isolation.
- Foreign account activity is verified as the same empty owner-scoped result as an unknown ID; direct account detail and other guessed resources use 404. The two targeted desktop journeys passed against the isolated local API/PostgreSQL stack; their mobile duplicates were intentionally skipped. Comprehensive independent security review remains open.

## 2026-10-23 — Private response cache policy

- Aligned authenticated identity, financial, and export responses with the plan's `Cache-Control: private, no-store` requirement. The shared route hook now supplies that policy only when a handler has not already set one.
- Strengthened Playwright assertions for owner-to-owner CSV/JSON transaction isolation and cache headers; scoped the Quick Add interaction to the primary navigation landmark to keep it deterministic.
- Fresh local Docker acceptance passed all 13 PostgreSQL integration tests and 24 Playwright tests with 8 expected skips; `npm run validate`, `npm run compose:check`, and `git diff --check` passed. No GitHub Actions run was started.

## 2026-10-23 — CSV formula-prefix hardening

- CSV text cells now guard formula markers following C1 control characters as well as whitespace and C0 controls. Added integration assertions for `=`, `+`, `-`, and `@` after control and Unicode whitespace prefixes.
- All 13 local PostgreSQL integration tests and 24 desktop/mobile Playwright tests passed; 8 project-specific skips were expected. No GitHub Actions run was started.

## 2026-10-23 — Port-isolated local acceptance

- Added a dedicated `compose.e2e.yaml` project with an ephemeral tmpfs PostgreSQL database and separate loopback ports for the web app, API, and database. The regular development stack can remain running during full-stack acceptance.
- Added `e2e:stack:up` / `e2e:stack:down` lifecycle scripts, included the E2E Compose topology in `compose:check`, and made Playwright web/API origins independently configurable.
- Ran the rebuilt worktree stack locally: all five migrations applied, all 13 PostgreSQL integration tests passed, and Playwright completed with 24 passes and 8 expected skips across desktop Chromium and Pixel 7 emulation. The disposable stack was removed; no GitHub Actions run occurred.

- Updated the owner/device review checklist to launch and remove the isolated tmpfs review stack, avoiding writes to persistent development data.

- Refreshed the 18-route desktop/mobile accessibility and keyboard review against the isolated stack: 36 light/dark axe scans passed with zero WCAG violations; reduced-motion checks also passed.

## 2026-10-23 — Production image hardening

- Added monthly grouped Dependabot updates for npm, GitHub Actions, and pinned container bases, with at most one open PR per ecosystem.
- Added digest-pinned, multi-stage production API/web image targets and a dedicated one-shot migration image. API/web runtime users are nonroot; the API runtime includes production dependencies only.
- Added a same-origin Nginx API proxy with CSP and browser security headers, cache policy for the shell/assets/service worker, and query-free access logs. Fastify request URLs are redacted to keep Activity search terms out of normal logs.
- Tightened API/web runtime layers to refresh Alpine packages and removed npm/corepack from the API runtime. Local Trivy HIGH/CRITICAL scans against final API/web IDs reported zero findings; Syft SPDX inventories were regenerated locally.
- Rebuilt the migration image with a minimal Prisma CLI dependency tree, omitted optional packages, and removed npm/corepack. All three final image IDs scan with zero HIGH/CRITICAL findings; the migration image applied all five migrations to a fresh disposable PostgreSQL database.
- Verified all three builds locally, applied five migrations to a fresh disposable PostgreSQL database, checked production API readiness, and passed five read-only Playwright journeys through the production web image. No image publication, GitHub Actions run, or deployment occurred.

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
- Expanded the local Playwright release review to all nine authenticated routes at desktop and Pixel 7-sized viewports, fixing undersized Activity controls, Quick Add mode tabs, dashboard links, and the mobile Settings privacy control before the full 18-combination baseline passed. Added settled dark-theme axe scans and keyboard focus traversal; all 36 light/dark route scans pass with zero focus failures.
- Added permanent Playwright coverage for Reports, CSV/JSON exports, Security, Categories, and cross-user export/account isolation.
- Recorded the read-only Phase 6 homelab audit and deployment safety boundary; no GitOps, cluster, secret, image-publication, cutover, or V1 resource action was performed.
- Added a PostgreSQL integration regression test for opposite-direction concurrent transfers, verifying deterministic lock ordering, balanced journals, and no balance drift. The clean local integration, one-worker Playwright, and full route accessibility review were rerun against the disposable Docker stack without starting GitHub Actions.
- Strengthened the API personal-response cache guard for dashboard, category, card, report, export, account, bill, transaction, identity, and preference routes; the real-stack browser flow now asserts no-store headers on representative financial reads.
- Added PostgreSQL coverage for variable bill payments: missing actual amounts are rejected, the confirmed amount posts once, and an identical retry returns the canonical result without a second expense.
- Verified the V2 migration upgrade path from the prior category-icon schema through the cards/bills migration in an isolated temporary PostgreSQL database.
- Strengthened the monthly-report integration fixture to verify a January expense refunded in February remains in January and produces negative February net expenses in the original category.
- Added the authenticated Quick Add contextual sheet with route-aware return navigation, focus trapping, Escape/backdrop close, unsaved-entry protection, and a direct-link full-page fallback; local Playwright covers the interaction.
- Added the repository ESLint baseline and required it in the existing PR validation job; the local lint pass also removed dead imports/assignments exposed by the new guardrail.
- Added the root `npm run validate` alias so the static lint, type, finance, format, secret, and audit gate can be run as one local command without Docker.
- Aligned Docker, CI, and local runtime requirements on Node 22.22 for the resolved React Router engine, and made Quick Add sheet focus wait for authenticated content before locking and focusing the dialog.
- Added local `backup:local` and `restore:local` aliases that validate custom-format PostgreSQL archives and isolated restores without writing backup data into the repository.
- Added `npm run compose:check` and made the existing real-stack CI job validate both Compose files before starting services.
- Strengthened `npm run validate` with the explicit workspace production build so the unified gate proves a Vite bundle as well as TypeScript correctness.
- Kept CI limited to pull-request validation, aligned every CI job on Node 22.22, and enabled cancellation of superseded PR runs so local Docker/Playwright validation remains the routine path and redundant action minutes are avoided.

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

## 2026-10-23 — Private CA and encrypted-secret groundwork

- Added a V2-only cert-manager root CA, namespaced issuing CA, and renewable leaf certificate for the planned private hostname. Kept the V2 Ingress in a cutover-only directory excluded from the default Kustomize root so V1 continues to own the hostname until an approved switch.
- Added private CA device-distribution, renewal, and recovery instructions that never export the CA private key.
- Added a SOPS/age runtime and backup-client Secret generator. It requires an owner-approved public age recipient, refuses overwrite, writes only encrypted output to the repository, and removes its mode-0700 plaintext temp directory.
- Verified the generator with SOPS 3.10.2 and a disposable age key, then removed the test key and outputs. Argo SOPS plugin configuration, owner key recovery, live certificate issuance, device trust, and cutover remain unverified.

## 2026-10-23 — Phase 6 production stack local acceptance

- Restored Docker access through `newgrp docker`, built fresh tagged web/API/migration/PostgreSQL/backup images, and exercised them in an isolated tmpfs Compose project without stopping the development stack.
- Fresh PostgreSQL accepted all five migrations; API health, web health, and the Nginx API proxy all returned 200. The isolated project was removed afterward.
- Trivy scans including unfixed findings reported zero HIGH/CRITICAL for all five images. Syft SPDX inventories were generated for each. No image was published and no GitHub Actions run was started.

## 2026-10-23 — Prometheus scrape and namespace alignment

- Added a chart-ready static API scrape target for the audited Prometheus Helm chart 25.19.1, using `api.monikey-v2.svc.cluster.local:3000` and avoiding Kubernetes discovery RBAC.
- Corrected migration and certificate expiry alert selectors from V1 namespace `monikey` to V2 namespace `monikey-v2`.
- Prometheus 3.5.0 `promtool` accepted the combined scrape config and all nine rules. No upstream GitOps values, cluster config, or alert routing was changed.

## 2026-10-23 — Backup metrics exporter and alert wiring

- Added a minimal nonroot exporter image that reads the backup PVC read-only, validates and allowlists the five backup metrics, and reports missing/invalid files without exposing arbitrary file contents.
- Added the exporter Deployment/Service and a NetworkPolicy permitting metrics ingress only from the monitoring namespace. Extended the pinned-chart scrape fragment and added a tenth backup-metrics validity alert.
- Added three unit tests and included them in `npm run validate`. The container passed a restricted local smoke test, Trivy reported zero HIGH/CRITICAL, Syft produced a 21-package SBOM, `promtool` validated both scrape jobs/ten alerts, and Kubernetes validation passed for the expanded 23-resource root. No cluster or upstream GitOps changes occurred.

## 2026-10-23 — Release verifier regression coverage

- Added isolated tests for the manual image-release guard. A local stub GitHub API checks pagination beyond 100 runs, success output for the exact merged main commit, refusal of a failed newest required check despite an older success, and refusal of a mismatched merge commit.
- Included `npm run test:release-verifier` in the local `npm run validate` gate. All three tests passed; they use localhost only and consume no Actions minutes.

## 2026-10-23 — Fresh PostgreSQL and browser acceptance

- Rebuilt the isolated E2E stack from the current worktree and passed all nine real-PostgreSQL integration suites (18 tests) plus 25 Playwright tests across desktop Chromium and Pixel 7 emulation; 9 mobile-project skips were expected.
- Corrected Prettier formatting in the implementation status record, then passed the complete local `npm run validate` gate.
- Removed the disposable tmpfs E2E stack. No GitHub Actions run or production change occurred.

## 2026-10-23 — Completed onboarding route correction

- Replaced stale READY-state onboarding copy and Home destination with the implemented Accounts route. The page header and empty-panel content now accurately describe completed first-account setup and ledger-backed account management.
- Added an authenticated Playwright regression assertion and verified it in the isolated Docker/API/PostgreSQL stack. Captured the rendered desktop state for the Obsidian project log.

## 2026-10-23 — Architecture audit evidence reconciliation

- Reconciled the architecture audit's local evidence with the latest current-worktree results: `npm run validate`, nine PostgreSQL integration suites, 25 Playwright passes with 9 expected skips, the onboarding READY-state regression, responsive/accessibility review, and the current 24-resource manifest tree.
- Rechecked the clean homelab GitOps source at the remote-matching SHA and clarified that missing kubeconfig/live Kubernetes tooling leaves cluster and Argo state unverified.

## 2026-10-23 — Linked refund mutation safeguards

- Protect posted linked refunds from becoming larger than their edited original or detached from its expense category: reject under-sized edits, recategorization, and voiding while refunds remain posted.
- Added PostgreSQL integration coverage that verifies each rejected mutation leaves journal and revision history unchanged. The transaction integration suite passed locally against disposable PostgreSQL.

## 2026-10-23 — Credit-card refund liability direction

- Card-purchase refunds now debit the credit-card liability and credit the original expense category, reducing debt and net spending without affecting income.
- Added PostgreSQL integration assertions for the exact liability posting, the ₱300 net-expense reduction, and the balance after a later card payment.

## 2026-10-23 — Concurrent bill-payment retry acceptance

- Extended the authenticated bill payment browser flow with simultaneous same-key retries and a fresh-key duplicate attempt.
- The real API returns the canonical paid occurrence for both retries, rejects a second payment with HTTP 409, and changes the funding account balance only once.

## 2026-10-23 — Concurrent statement allocation acceptance

- Extended the authenticated card journey to race two distinct ₱40,000 payments against ₱70,000 remaining on one statement.
- Exactly one payment is accepted; the competing request returns HTTP 409, and the statement allocation and funding account reflect a single debit.

## 2026-10-23 — Effect-level reduced-motion verification

- Strengthened `npm run review:local` to probe the real skeleton animation and amount-control transition classes under reduced-motion emulation.
- The review now asserts 0.01ms animation/transition durations and a single animation iteration at all five viewport widths; the fresh 45-route/90-scan review passed.
