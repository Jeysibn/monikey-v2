# ADR-001: Double-entry immutable financial journal

- Status: Accepted by approved product plan
- Date: 2026-10-22
- Owners: MoniKey project owner
- Related plan items: Sections 4–7, P2-03–P2-11

## Context

Transfers, fees, card debt, refunds, reversals, and adjustments must not create duplicate income or spending or lose audit history. Independently stored account balance counters can drift from their transactions.

## Decision

Use a small internal double-entry journal as the only financial source of truth. Postings use positive absolute minor-unit amounts and explicit debit/credit directions. Every journal balances. Posted rows are immutable; edits and logical deletion use compensating reversals and audited replacement entries. `ledger` is the only module allowed to write postings.

## Consequences

Balances and reports are derived from postings. Financial writes need PostgreSQL transactions, ownership checks, idempotency, and concurrency controls. No financial feature is complete with a frontend-only calculation or fake finance adapter.

## Alternatives considered

Mutable account totals and single-entry transaction rows were rejected because they do not provide the approved audit and balance guarantees.
