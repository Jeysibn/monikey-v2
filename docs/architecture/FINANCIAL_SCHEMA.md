# Financial schema contract

Status: implementation in progress for P2-03. This document translates sections 4 and 6 of `MONIKEY_V2_MASTER_PLAN.md` into the initial PostgreSQL schema contract.

## Ownership

Every financial row carries `user_id`. References between user-owned rows use composite `(user_id, id)` foreign keys, so a valid UUID from another user cannot be attached accidentally. The database is not a substitute for filtering every API read by the authenticated session owner.

## Source of truth

`financial_accounts` and `categories` describe user-facing entities. `ledger_accounts` map those entities to accounting types. `transactions` and `transaction_revisions` describe user actions and audit history. `journals` plus positive `postings` are the only balance source. Opening balances and corrections are journal actions; no mutable balance column is stored on a financial account.

Each committed journal must have at least two postings and equal debit and credit totals. A deferred PostgreSQL constraint trigger checks this at transaction commit. Journals, postings, revisions, and audit events reject direct update/delete; corrections append compensating records.

## Initial scope

The migration includes accounts, categories, ledger mappings, transactions, revisions, journals, postings, per-user idempotency records, and append-only audit events. Statement, recurring bill, and occurrence tables are deferred to their respective approved work packages; the initial schema leaves their future links out rather than adding unvalidated unused tables.

## Money and dates

Persisted amounts are positive PostgreSQL `BIGINT` minor units, with debit/credit direction stored separately. Database sums use exact `numeric` accumulation. `occurred_on` is a PostgreSQL `DATE` interpreted as Asia/Manila business date; technical event timestamps are `TIMESTAMPTZ`.

## Compatibility and verification

Migrations must apply to both a fresh database and the current V2 schema. P2-03 tests exercise composite ownership, type checks, positive amounts, immutable history, balanced journals, and migration application. The schema has no V1 data or migration dependency.
