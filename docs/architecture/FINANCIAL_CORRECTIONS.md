# Financial corrections, card credit, and bill occurrence behavior

This page documents the correction and recurring-bill rules implemented by the
ledger service and Bills API. All amounts are decimal-string minor units; the
ledger service remains the only writer of financial postings.

## Linked corrections

- A card payment has a statement allocation linked to its transaction. Voiding
  the payment reverses the active allocation in the same database transaction
  as the ledger reversal. Statement remaining due is calculated from active
  allocations only; allocation rows remain as history with their reversal time
  and reason.
- A bill payment links one occurrence, transaction, and actual amount. Editing
  the linked expense updates the occurrence amount and records an `EDITED`
  payment-history row atomically with the new transaction revision and journal.
  Voiding it records `VOIDED`, clears its active payment link/amount, and reopens
  the occurrence as upcoming or overdue according to the Manila server date.
  A replacement payment is a new linked transaction and history row.
- These paths use the ledger transaction and do not update balances directly.
  Posted journals and their postings remain immutable; corrections add reversal
  journals and append-only audit/history records.

## Recurrence edits and enumeration

Changing a bill's amount mode, default amount, due day, start/end date, or
active/paused status locks the bill rule and removes unpaid generated
occurrences from the current Manila month onward. Paid and skipped occurrences
remain unchanged. Generation locks active bill rules while creating rows and
does not recreate an occurrence in a month that already contains a paid or
skipped terminal occurrence. This serializes generation against rule edits and
prevents a changed day from leaving a stale duplicate behind.

The Bills occurrence endpoint and dashboard hold those rule locks in the same
database transaction through occurrence generation and result materialization.
A concurrent rule update therefore runs either before generation reads the
rule or after the requesting result has committed; it cannot interleave after
the lock query and leave old-day rows alongside the updated schedule.

Occurrence, Activity, and export query dates use the shared Gregorian date
schema. OpenAPI advertises `format: date` and a real-calendar pattern; the API
returns field-level HTTP 400 validation responses before any PostgreSQL date
cast. A requested occurrence window must be ordered and at most 366 days wide.
The UI requests a three-month window; the API applies the same bound to all
callers.

## Explicit balance confirmations

Overdraft acknowledgement and card-credit acknowledgement are separate
request fields and user actions. A card payment, card refund/adjustment, an
expense correction that affects card debt, or a reversal that would leave a
card credit balance requires `acknowledgeCardCreditBalance: true`. The API
returns a conflict without posting if that field is absent; the UI then shows
the projected credit amount and asks for a second explicit action. Asset
overdrafts continue to use `acknowledgeNegativeBalance` and show the projected
asset balance where the flow supports confirmation. When one command needs
both approvals, the UI retains the first approval while asking for the second,
sends both acknowledgement fields after both user actions, and clears them if
any submitted field changes.

Income and expense edits calculate the net effect of reversing the old posting
and applying the replacement to every affected account. This includes a source
account when an income entry is moved, and credit-card liability reversal signs
follow the ledger's balance convention. Reversal confirmation covers affected
asset and card accounts, displays their names and exact projected PHP balances,
and requires the corresponding explicit acknowledgement before the ledger
reversal is posted.

Bill overdraft projection uses the same amount as the pending payment request:
the expected fixed amount or the entered variable amount. Changing the funding
account or entered amount clears the confirmation until the updated request is
reviewed.

## Retry identity and UI recovery

Bill/account/card/statement and transaction forms retain an idempotency key for
the exact unresolved payload. A transport/server failure keeps that identity
so retry replays a committed request instead of creating a duplicate. A
terminal client response clears the pending identity; changing the payload
uses a new identity. Bill create/edit/status/payment actions keep pending state
and display errors until the request is retried or corrected. Bill rules can be
edited, paused/resumed, archived, and restored; archiving preserves payment
history.

## Schema change and verification

Migration `20261024000000_linked_corrections_and_occurrences` adds reversible
statement-allocation metadata and append-only bill occurrence payment history.
The database keeps allocation and history ownership linked to the bill,
occurrence, transaction, and user. PostgreSQL integration tests cover statement
reallocation after void, bill pay/edit/void/reopen/replacement, recurrence
updates, and the card-credit acknowledgement boundary. Real API browser tests
cover field-level HTTP date/window errors, bill edit/archive/restore, status and
create retry identity, account opening-balance and statement-create response
loss recovery, combined overdraft/card-credit confirmation, and projected
variable-bill overdraft confirmation.

Independent final QA evidence, including the full browser retest and remaining
limitations, is recorded in
[`QA_FINANCIAL_CORRECTIONS_2026-10-24.md`](../qa/2026-10-24/QA_FINANCIAL_CORRECTIONS_2026-10-24.md).
