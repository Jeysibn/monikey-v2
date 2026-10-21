# Transaction commands

P2-07 introduces the first posted user transactions: one-account income and expense commands. The API is owner-scoped and writes a stable transaction, revision, balanced journal, postings, and audit event in one PostgreSQL transaction.

## Command contract

`POST /api/v1/transactions` accepts:

- `kind`: `INCOME` or `EXPENSE`.
- `sourceAccountId`: an active owned cash, bank, or e-wallet account. The same field is the receiving account for income.
- `categoryId`: an active owned category whose kind matches `kind`.
- `amountMinor`: a positive PHP minor-unit string within PostgreSQL `BIGINT` range.
- `occurredOn`: a server-valid date no later than the server's Asia/Manila day.
- `note`: optional trimmed text up to 500 characters.
- `acknowledgeNegativeBalance`: required for an expense that would make the asset balance negative.

Writes require same-origin checks, an authenticated session, CSRF, and a user-scoped `Idempotency-Key`. A replay with the same payload returns the original transaction and account balance; a changed payload returns `409`.

## Journal mapping

| Command | Debit                           | Credit                         |
| ------- | ------------------------------- | ------------------------------ |
| Expense | Expense category ledger account | Asset account ledger account   |
| Income  | Asset account ledger account    | Income category ledger account |

The ledger service locks the affected financial account, validates ownership, and inserts the immutable journal/postings. Account balances are read from the posted ledger after commit work completes; no independent balance counter is maintained.

Credit card purchases, transfers, refunds, edits, and reversals remain later vertical slices. Archived accounts/categories and cross-owner IDs return a non-enumerating not-found response.
