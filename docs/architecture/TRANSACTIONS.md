# Transaction commands

## Quick Add client flow

The authenticated Quick Add screen reads the owner-scoped account and category lists, then posts one of the existing command shapes to `POST /api/v1/transactions`. It sends exact minor-unit strings, the server-owned Manila date, optional notes, a fresh idempotency key, and the session CSRF token. Expense and income use matching category kinds; transfers can include a positive expense fee and fee category. A negative-balance conflict is shown as an explicit confirmation and retried with `acknowledgeNegativeBalance: true`. Signed-out visitors see the existing preview form, which never sends a mutation.

P2-08 adds owner-scoped transfers, linked refunds, and explicit adjustments to the P2-07 income and expense commands. P2-09 adds audited edits and logical deletion on top of the same append-only model. Every command writes a stable transaction, revision, balanced journal, postings, and audit event in one PostgreSQL transaction.

## Command contract

`POST /api/v1/transactions` accepts these command shapes:

### Income and expense

- `kind`: `INCOME` or `EXPENSE`.
- `sourceAccountId`: an active owned cash, bank, or e-wallet account. The same field is the receiving account for income.
- `categoryId`: an active owned category whose kind matches `kind`.
- `amountMinor`: a positive PHP minor-unit string within PostgreSQL `BIGINT` range.
- `occurredOn`: a server-valid date no later than the server's Asia/Manila day.
- `note`: optional trimmed text up to 500 characters.
- `acknowledgeNegativeBalance`: required for an expense that would make the asset balance negative.

### Transfer

- `kind`: `TRANSFER`.
- `fromAccountId` and `toAccountId`: two different active owned cash, bank, or e-wallet accounts.
- `amountMinor`: a positive PHP minor-unit string within PostgreSQL `BIGINT` range.
- `feeMinor`: optional non-negative fee. A positive fee requires `feeCategoryId`.
- `feeCategoryId`: an active owned expense category when a fee is present.
- `occurredOn`, `note`, and `acknowledgeNegativeBalance`: the same date, note, and source-balance rules as the other commands.

### Refund

- `kind`: `REFUND`.
- `sourceAccountId`: the owned active account receiving the refund (asset) or crediting a card liability.
- `refundedTransactionId`: an owned, posted `EXPENSE` transaction with remaining refundable amount.
- `amountMinor`, `occurredOn`, and `note`: positive amount, server-valid date, and optional note.

The refund inherits the original expense category and is separately dated. It credits that category, reducing net spending in the refund period without creating income.

### Adjustment

- `kind`: `ADJUSTMENT`.
- `accountId`: an owned active asset or credit card account.
- `direction`: `INCREASE` or `DECREASE` from the account's signed balance perspective.
- `amountMinor`, `occurredOn`, `note`, and `acknowledgeNegativeBalance`: positive amount, server-valid date, optional note, and explicit confirmation when a decrease projects a negative balance.

Adjustments post against a per-owner `ADJUSTMENT` equity ledger account and never affect income or spending.

Writes require same-origin checks, an authenticated session, CSRF, and a user-scoped `Idempotency-Key`. A replay with the same payload returns the original transaction and account balance; a changed payload returns `409`.

## Revisions and logical deletion

`PATCH /api/v1/transactions/:id` currently edits posted income and expense commands. The request carries the complete replacement command plus a required reason. The transaction row keeps its stable ID while the service locks the row and all affected accounts in deterministic order, posts a compensating `REVERSAL` journal for the active journal, increments `current_revision`, updates the user-facing fields, and posts the replacement journal in one database transaction.

`DELETE /api/v1/transactions/:id` requires a reason and marks the transaction `VOID` after posting one compensating reversal journal. A transaction can only have one active journal and one reversal for each journal; repeated deletion returns a conflict and cannot double reverse the money. Posted journals and postings are never updated or deleted directly.

`GET /api/v1/transactions/:id` returns the owner-scoped stable record. `GET /api/v1/transactions/:id/audit` returns immutable revision metadata, before/after JSON, reasons, and UTC timestamps. Mutation retries include the transaction ID in the idempotency fingerprint.

## Activity reads

`GET /api/v1/transactions` returns the owner-scoped activity feed. It joins each transaction to its current revision and supports `kind`, `status`, `accountId`, `categoryId`, `from`, `to`, and note `search` filters. Results are sorted by `occurredOn DESC`, `createdAt DESC`, and `id DESC`.

The `limit` query parameter is bounded to 1–100 (default 50). `nextCursor` is an opaque base64url cursor containing the last row's `(occurredOn, createdAt, id)` tuple; the service uses that tuple for keyset pagination. `GET /api/v1/accounts/:accountId/activity` applies the same contract with a required owner-scoped account filter. Both responses include the server's Asia/Manila `serverToday`.

Account filtering checks all command-specific account fields in the current revision (`sourceAccountId`, `accountId`, `fromAccountId`, and `toAccountId`). The SQL query always applies the authenticated `user_id` first, so guessed transaction, account, category, or cursor values cannot cross owner boundaries.

## Journal mapping

| Command              | Debit                                          | Credit                         |
| -------------------- | ---------------------------------------------- | ------------------------------ |
| Expense              | Expense category ledger account                | Asset account ledger account   |
| Income               | Asset account ledger account                   | Income category ledger account |
| Transfer without fee | Destination asset account                      | Source asset account           |
| Transfer with fee    | Destination asset account and expense category | Source asset account           |
| Refund               | Receiving asset account                        | Original expense category      |
| Adjustment increase  | Adjusted account                               | Adjustment equity              |
| Adjustment decrease  | Adjustment equity                              | Adjusted account               |

Transfers lock both accounts in deterministic ID order before checking the source balance. A fee is posted as an expense category debit in the same balanced transfer journal, so it appears in spending without becoming income. The ledger service validates ownership and inserts the immutable journal/postings. Account balances are read from the posted ledger after commit work completes; no independent balance counter is maintained.

Credit card purchases remain a later vertical slice. Archived accounts/categories and cross-owner IDs return a non-enumerating not-found response. All command retries use the same owner-scoped idempotency behavior.
