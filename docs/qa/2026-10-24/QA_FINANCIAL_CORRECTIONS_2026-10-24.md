# Independent QA: Financial corrections, 2026-10-24

## Verdict

F1–F8 passed independent review against `docs/qa/2026-10-24/PROJECT_ANALYSIS_2026-10-24.md`
and `MONIKEY_V2_MASTER_PLAN.md`. The audit found a bill-rule generation race
that the original full suite missed; after the API and Dashboard routes were
changed to keep generation and reads in one transaction, both the independent
API/PostgreSQL reproducer and the deterministic browser regression passed. The
updated full browser suite passed with no failures. No production service, V1
resource, or cluster was changed.

## Findings

| Finding                                            | Verdict | Independent evidence                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1 — Card payment void restores statement due      | PASS    | `apps/api/src/card-statements.integration.test.ts`: void reverses the active allocation, restores remaining due, and permits replacement settlement; the related card-payment browser journey passed.                                                                    |
| F2 — Bill payment correction and void are atomic   | PASS    | `apps/api/src/bills.integration.test.ts`: linked expense edit updates actual amount/history; void reopens the occurrence; replacement payment creates new history. The full PostgreSQL bill suite passed.                                                                |
| F3 — Future occurrences reconcile safely           | PASS    | PostgreSQL sequential checks verify rule edits and paid-history preservation. The deterministic actual-API/PostgreSQL browser regression covers concurrent generation and rule edits on Bills and Dashboard; the independent API probe passed after the transaction fix. |
| F4 — Card credit requires separate acknowledgement | PASS    | PostgreSQL card-statement tests enforce the card-credit guard. Browser coverage passed the combined overdraft/card-credit confirmation, including retaining both approvals and clearing them when the submitted payload changes.                                         |
| F5 — Secondary overdraft confirmation              | PASS    | Browser journeys passed for variable-amount bill payment projections, expense correction/reversal projections, and reduced/moved income edits and reversals. They assert projected balances and the explicit confirmation step.                                          |
| F6 — Create retries preserve identity              | PASS    | Actual API/browser response-loss tests passed for account opening balance and card statement creation after reload; bill, card-payment, and transaction retry journeys also passed. Replays used the same key and did not duplicate the resource.                        |
| F7 — Bill management UI                            | PASS    | Browser coverage passed edit, pause/resume, archive/restore, status-request error recovery, and bill-create response-loss retry.                                                                                                                                         |
| F8 — Calendar dates and occurrence bounds          | PASS    | Authenticated direct-HTTP browser checks passed: impossible occurrence/activity/export dates returned field-level 400 responses; reversed and 367-day occurrence windows returned 400; a valid leap-day query returned 200. OpenAPI declares the date format.            |

### F3 concurrency race: reproduced, fixed, and retested

The regular bill integration test verifies sequential schedule edits and paid
historical fidelity, but did not coordinate occurrence generation with a rule
update. The independent actual-API probe reproduced the race on PostgreSQL
17.6: it gated an occurrence insert with a temporary trigger, started
`GET /api/v1/bills/occurrences?from=2026-11-01&to=2026-12-31`, and during the
gate sent `PATCH /api/v1/bills/:billId` with `{ "dueDay": 27 }`. Before the fix,
the patch returned 200 while the GET was paused; the in-flight GET inserted
dates from the old rule, and a later GET generated the new dates alongside
them.

```sh
npx tsx .qa-recurrence-race.ts
```

Before-fix result:

```json
{
  "patchStatus": 200,
  "patchDay": 27,
  "generationStatus": 200,
  "firstWindowDates": ["2026-11-25", "2026-12-25"],
  "secondWindowDates": ["2026-11-25", "2026-11-27", "2026-12-25", "2026-12-27"],
  "staleOldDayObserved": true
}
```

The occurrence route called `listBillOccurrences` via `withDatabaseConnection`
in `apps/api/src/server.ts`; the generator's `SELECT ... FOR SHARE` therefore
released its row lock before the later inserts. Dashboard summary had the same
call pattern. The fix changes both occurrence listing and dashboard summary to
use `withDatabaseTransaction`, so the shared rule-row lock lasts through
materialization and read. The committed browser test
`bill occurrence generation serializes rule edits on Bills and Dashboard`
uses a PostgreSQL advisory-lock barrier to prove the PATCH waits for generation
on both routes. It passed independently on the rebuilt API stack. I reran the
independent probe after the fix; the subsequent read returned only the new due
dates:

```json
{
  "patchStatus": 200,
  "patchDay": 27,
  "generationStatus": 200,
  "firstWindowDates": ["2026-11-25", "2026-12-25"],
  "secondWindowDates": ["2026-11-27", "2026-12-27"],
  "staleOldDayObserved": false
}
```

The temporary probe, trigger, function, bill, occurrences, and any named test
account were removed when the disposable stack was reset after the regression
was incorporated.

## Commands and results

The final independent browser run used a freshly reset and seeded disposable
stack. The documented disposable owner and E2E users were created as described
in `docs/qa/history/TESTING_HISTORY.md`. The Playwright config was temporary and was removed after
the run; it selected `/usr/bin/chromium-browser`, one worker, and desktop Chrome
plus Pixel 7 emulation.

```sh
npm run e2e:stack:down && npm run e2e:stack:up

COMPOSE_FILE=compose.e2e.yaml \
COMPOSE_PROJECT_NAME=monikey-e2e \
PLAYWRIGHT_BASE_URL=http://localhost:18080 \
PLAYWRIGHT_API_BASE_URL=http://localhost:13000 \
  npx playwright test --config=.qa-chromium.config.ts
```

Result: **40 passed, 24 project-specific skips, 0 failed** (64 total, 1.5
minutes). Desktop-only and mobile-only cases skip in the opposite project. The
new F3 Bills/Dashboard concurrency regression passed in this run.
System Chromium reported version **155.0.8059.39**. Playwright's pinned
browser was unavailable locally and its browser download could not complete,
so the installed system Chromium was launched through the temporary config.

The two findings from the first full run were investigated and rerun:

- First run: 37 passed, 23 project-specific skips, 2 failed. One test edited a
  ₱25 expense to ₱20 against an account with ₱123.45, so the projected balance
  stayed positive; its expectation of a negative-balance confirmation was
  stale. The test was corrected to assert that no confirmation panel appears,
  and the clean full rerun passed it.
- The other failure was the expense/income retry journey, which restarts the
  API container. My first command omitted the required `COMPOSE_FILE` and
  `COMPOSE_PROJECT_NAME`; a subsequent attempt on the already-used stack hit
  its login rate limit (HTTP 429). After resetting the disposable stack and
  providing the documented Compose variables, the targeted journey passed,
  and it passed again in the clean full run.

After resetting and reseeding the stack, I reran both previously failing
journeys with the correct Compose settings:

```sh
COMPOSE_FILE=compose.e2e.yaml \
COMPOSE_PROJECT_NAME=monikey-e2e \
PLAYWRIGHT_BASE_URL=http://localhost:18080 \
PLAYWRIGHT_API_BASE_URL=http://localhost:13000 \
  npx playwright test --config=.qa-chromium.config.ts \
  --grep "private login, session recovery, CSRF protection, and logout work|expense and income commands are balanced and retry-safe"
```

Result: **2 desktop tests passed, 2 mobile project skips**.

Independent PostgreSQL integration run:

```sh
DATABASE_URL=postgresql://monikey@localhost:15432/monikey_e2e \
  npm run test:integration
```

Result: **9 PostgreSQL integration suites, 23 tests passed** against the actual
API and PostgreSQL 17.6. This included cards, bills, reports, idempotency, and
the real API transfer process-kill rollback suite.

Independent migration upgrade run:

```sh
MIGRATION_TEST_ALLOW_CREATE_DB=1 \
MIGRATION_TEST_DATABASE_URL='postgresql://monikey@localhost:15432/monikey_e2e?schema=public' \
  npm run test:migration-upgrade
```

Result: passed. The script applied the prior migrations, applied the current
migration, verified the migration ledger and resulting tables, and removed its
own scratch database. This was run before the F3 route-only transaction fix;
that fix did not change the migration chain.

Additional independent check: `git diff --check` passed. The implementation
agent reported `npm run validate`, `npm run compose:check`, and OpenAPI
declaration parity passed; those three commands were not independently rerun
for this QA report.

## Scope and limitations

- Browser coverage used Chromium only. Pixel 7 is Playwright device emulation,
  not a physical phone; Firefox, WebKit, native mobile, and assistive technology
  hardware were not exercised in this pass.
- No GitHub Actions run or live-cluster acceptance was performed. Production,
  GitOps, and V1 remained untouched.
- Integration and browser checks used the disposable local PostgreSQL 17.6
  stack and local API/web containers. They do not establish production
  deployment or operational readiness.

## Worktree fingerprint

- Base commit: `ff24ae7`.
- Branch: `feature/financial-corrections-f1-f8`.
- The implementation and QA test changes remain uncommitted. The source diff
  covers API services and integration tests, web UI, contracts/OpenAPI, the
  linked-corrections migration, E2E tests, and supporting docs. The original
  untracked `docs/qa/2026-10-24/PROJECT_ANALYSIS_2026-10-24.md` was preserved. This report is
  also a new untracked documentation artifact until committed.
- The temporary `.qa-chromium.config.ts` used only for browser fallback was
  removed after verification.
