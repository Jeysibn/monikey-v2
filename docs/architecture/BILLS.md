# Recurring bills

Bills are owner-scoped monthly reminders. A bill stores its name, expense category, optional suggested funding account, fixed or variable amount mode, optional fixed amount, due day, start/end dates, status, and note.

## Occurrence generation

The Bills API and dashboard deterministically upsert occurrences for their requested date window. A due day that does not exist in a month is clamped to that month’s last day, so day 31 produces February 28 or 29. A unique owner/bill/due-date constraint prevents duplicates. Upcoming occurrences before the server-owned Asia/Manila date become overdue when read.

## Payment and skip

`POST /api/v1/bills/occurrences/:id/pay` requires a funding asset and creates one ordinary expense through the shared transaction service. Fixed occurrences use their expected amount; variable occurrences require a positive confirmed amount. The occurrence row is locked before payment so competing commands serialize. The occurrence is marked `PAID` only in the same database transaction that records the linked transaction. Concurrent retries with the same owner-scoped idempotency key replay the canonical paid response; a new-key payment attempt after the occurrence is paid returns a conflict without posting another expense. `POST .../skip` marks an unpaid occurrence `SKIPPED` without posting money. Both commands require CSRF/origin checks.

Unpaid bills never change account balances or Available Money. Paid bills appear in Activity and retain the linked transaction ID. Bill rules can be paused, resumed, or archived; paid history remains intact.
