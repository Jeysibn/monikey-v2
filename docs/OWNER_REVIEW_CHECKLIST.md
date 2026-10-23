# MoniKey V2 owner and device review checklist

This checklist is the handoff for the master plan’s human release gates. Automated local checks do not mark these items complete. Record the actual device, browser, date, result, and blocker for every item.

## Before review

- [ ] Start the isolated review stack with `npm run e2e:stack:up`; it uses tmpfs PostgreSQL and separate loopback ports without stopping the development stack.
- [ ] Seed only the disposable review users using the commands in `docs/TESTING.md`.
- [ ] Confirm the reviewer is not entering real financial data into the local database.
- [ ] Have the current [release review](RELEASE_REVIEW.md), [architecture audit](architecture/ARCHITECTURE_AUDIT.md), and [restore runbook](runbooks/restore.md) open.
- [ ] Record the device model, OS version, browser version, viewport/orientation, and review commit.
- [ ] Review the [mobile/desktop route-flow draft](design/LOW_FIDELITY_FLOWS.md) and the automated [five-width Home and authenticated route screenshot gallery](RELEASE_REVIEW.md#current-owner-review-screenshots), including Account Detail and Card Statements; use it as a visual reference, not as a substitute for actual-device review.

## Phase 1 visual and interaction review

- [ ] Home, Activity, Add, and Accounts are clear on a phone without unnecessary navigation steps.
- [ ] Account Detail and Card Statements distinguish ledger-derived card debt from issuer-entered statement amounts and make their actions clear on phone and desktop.
- [ ] Bills, Reports, and Settings are discoverable through the secondary navigation.
- [ ] 360px, 390px, 768px, 1440px, and 1920px layouts have no clipped content or horizontal scrolling.
- [ ] Light and dark themes preserve readable text, semantic colors, charts, and focus indicators.
- [ ] Keyboard-only navigation reaches every control in a logical order and visibly restores focus after dialogs/sheets close.
- [ ] Reduced-motion mode removes nonessential transitions and does not hide state changes.
- [ ] Empty, loading, error, disabled, and unauthorized states are understandable and contain no fake financial records.

## Phase 3/4 financial workflow review

- [ ] First account and opening balance appear only after the server confirms the journal-backed operation.
- [ ] Quick Add expense, income, transfer, fee, refund, and adjustment flows show pending, error, retry, and negative-balance confirmation states.
- [ ] Activity filters, detail, edit, reversal, and logical deletion preserve history after reload.
- [ ] Accounts show ledger-derived balances and retain archived history.
- [ ] Card purchase, payment, utilization, statement allocation, and statement correction labels are clear.
- [ ] Bills show upcoming/overdue/paid/skipped states; unpaid reminders do not reduce Available Money.
- [ ] Repeated submission or retry does not duplicate a journal or bill payment.

## Phase 5 security, export, and accessibility review

- [ ] Reports reconcile with Activity and display exact PHP values in both themes.
- [ ] CSV export opens with quoted fields, intact negative/large minor units, and formula-safe text.
- [ ] JSON export uses `/api/v1/exports/data.json`, contains only the signed-in owner’s records, and contains no secrets.
- [ ] Session listing, revocation, password rotation, category archive, and category restore work as expected.
- [ ] A second disposable user cannot read guessed owner IDs or export owner records.
- [ ] A screen reader announces headings, form labels, validation errors, dialogs, alerts, and export controls.
- [ ] Contrast and touch-target review passes on the actual phone and desktop.

## Recovery and release decision

- [ ] The local backup/isolated restore drill is recorded before any real financial use.
- [ ] Production backup, TLS, secret, migration, monitoring, and rollback evidence is available before Phase 6 approval.
- [ ] Owner accepts the remaining same-host backup risk and the no-V1-data-migration boundary.
- [ ] Stop the isolated review stack with `npm run e2e:stack:down` so all review data is removed.

| Review gate                            | Device/environment | Date | Result  | Blockers/evidence |
| -------------------------------------- | ------------------ | ---- | ------- | ----------------- |
| Phase 1 visual/interaction             |                    |      | Pending |                   |
| Phase 4 cards/bills                    |                    |      | Pending |                   |
| Phase 5 reports/security/accessibility |                    |      | Pending |                   |
| Recovery/readiness                     |                    |      | Pending |                   |
| Owner release decision                 |                    |      | Pending |                   |

Until the checklist is completed and signed, the repository status must continue to show the affected phase gates as pending.
