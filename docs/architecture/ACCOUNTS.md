# Unified Accounts

Accounts are owner-scoped financial records whose balances are derived from the ledger. The P3-05 screens use `GET /api/v1/accounts` for the active list, `GET /api/v1/accounts?includeArchived=true` for history, and `GET /api/v1/accounts/:accountId/activity` for account-specific activity.

## Screen behavior

- The Accounts screen lists cash, bank, e-wallet, and card records with exact PHP balances and an optional archived-history view.
- New accounts use the existing idempotent account command and record an equity-backed opening balance in one transaction.
- Account detail shows the ledger-derived balance, recent account activity, and metadata editing for name and sort order.
- Archive is an idempotent owner-scoped mutation. It prevents future postings while retaining the account and all historical records.
- Guessed or cross-owner account IDs return the shared non-enumerating not-found response; signed-out routes explain that account data is private without requesting records.

The fresh local browser acceptance flow covers account navigation, metadata rename, archive feedback, and the retained history path against real PostgreSQL and the actual API.
