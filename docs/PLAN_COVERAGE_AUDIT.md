# Master plan coverage audit

Updated: 2026-10-22

This audit maps the approved `MONIKEY_V2_MASTER_PLAN.md` to the current V2
repository. It distinguishes implementation evidence from owner, device, and
production gates. A passing local check does not close a gate that the plan
assigns to an owner review or to the live homelab.

## Coverage summary

| Plan area                        | Current evidence                                                                                                                                                                                                                                        | State                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P0 foundation and guardrails     | Public `Jeysibn/monikey-v2`, npm workspaces, strict TypeScript, ESLint, Compose PostgreSQL/API/web/migrate, OpenAPI contracts, secret scan, CodeQL workflow, and Obsidian project records.                                                              | Implemented; image provenance remains a Phase 6 gate.                                                                               |
| P1 UX and component system       | Blue/navy semantic tokens, light/dark themes, responsive shell, 44px target checks, reduced motion, route skeleton, screenshots, keyboard traversal, and accessible Quick Add sheet.                                                                    | Implemented locally; physical-device, full screen-reader, contrast walkthrough, and owner approval remain.                          |
| P2 identity and financial domain | Argon2id private bootstrap, secure sessions, CSRF/origin/rate limits, PHT dates, exact bigint minor units, balanced immutable journals, account/category lifecycle, commands, revisions, refunds, adjustments, concurrency locks, and activity queries. | Backend and real-Postgres evidence complete.                                                                                        |
| P3 private alpha                 | Onboarding, server-backed dashboard, Activity, Accounts, PWA shell, offline write protection, privacy masking, theme persistence, and Quick Add.                                                                                                        | Local alpha evidence complete; owner/device sign-off and backup readiness remain.                                                   |
| P4 cards and recurring bills     | Card purchases, liability and utilization, statements, partial payment allocation, correction audit, fixed/variable bills, deterministic occurrences, pay/skip, and dashboard widgets.                                                                  | Local API/browser evidence complete; owner/device sign-off remains.                                                                 |
| P5 reports and release polish    | Monthly reports, exact CSV/JSON exports, security and category settings, full local route review, architecture audit, and one-worker Playwright acceptance.                                                                                             | Automated baseline complete; independent QA, full WCAG review, physical-device review, backup readiness, and owner sign-off remain. |
| P6 production replacement        | Read-only public GitOps audit and restore runbook only. No manifests, secrets, cluster changes, image publication, cutover, or V1 deletion were performed.                                                                                              | Pending authoritative homelab access and explicit owner approval.                                                                   |

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

## Current local evidence

The latest clean disposable Docker stack used real PostgreSQL, the actual API,
the web container, and Playwright with one worker:

- `npm run typecheck` — passed.
- `npm run lint` — passed with the repository ESLint baseline.
- `npm run validate` — passed as the combined static, database-free gate.
- The combined gate explicitly runs the workspace production build in addition
  to TypeScript checks.
- `npm ci --ignore-scripts --offline` — clean lockfile install completed with zero vulnerabilities.
- `npm run build --workspace @monikey/web` — passed.
- `npm run format:check` and `git diff --check` — passed.
- `npm run security:secrets` — passed for 119 tracked files.
- `npm run test:full-stack` — 24 passed and 8 intentional mobile/desktop skips.
- `npm run review:local` — all 18 route/viewport combinations passed in light
  and dark themes with zero axe violations, focus failures, page/API errors,
  overflow, unnamed controls, or undersized targets. API p95 was 38 ms on
  desktop and 180 ms at Pixel 7 size.
- PostgreSQL integration, migration-upgrade, backup/isolated-restore,
  contracts, exact-money/property, and cache-header checks are recorded in
  `docs/TESTING.md`, `docs/RELEASE_REVIEW.md`, and the architecture audit.
- `npm run backup:local` and `npm run restore:local` now automate the local
  custom-format backup/listing and isolated restore checks without storing an
  archive in the repository.
- `npm run compose:check` validates the base Compose topology and disposable
  local-test override before local or CI service startup.

No GitHub Actions run was started for this evidence. The PR workflow remains
configured for merge protection and now seeds the dedicated sheet-test user.

## Remaining release gates

1. Owner reviews navigation and visual direction on an actual phone and
   desktop, including screen reader, contrast, focus, reduced motion, and
   touch behavior.
2. Owner accepts the local backup/restore evidence and the same-host backup
   risk before real financial use.
3. The authoritative homelab checkout and live cluster conventions are
   inspected before writing any P6 manifests, secrets, migration Job, backup
   CronJob, monitoring, or TLS changes.
4. Image publication, digest traceability, GitOps promotion, cutover, rollback,
   and V1 resource retention require a separate owner-approved release.
