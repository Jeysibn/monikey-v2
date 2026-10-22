# Account lifecycle contract

## First-account onboarding

The private-alpha entry point is `POST /api/v1/onboarding/first-account`. It uses the strict account contract, requires an authenticated owner session, same-origin mutation checks, CSRF, and an idempotency key. The transaction locks the owner row before checking for existing accounts, so concurrent requests cannot create two first accounts. A successful request creates the financial account, its ledger account, and an equity-backed opening journal entry when the opening amount is positive. A replay with the same idempotency key returns the original result; a later first-account attempt returns `409`.

The web client sends unauthenticated visitors to sign in, then guides owners with `NEEDS_FIRST_ACCOUNT` through account type, name, optional institution, and opening balance. The profile changes to `READY` only after the persisted account exists.

P2-05 provides private API operations for financial account creation, balance reads, renaming, ordering, and archival. Account records are always scoped by the session owner's `user_id`; a missing or foreign ID returns the same 404 envelope.

## Opening balances

Account creation requires an exact nonnegative minor-unit string. Zero creates the account and ledger mapping without a zero-value journal. A positive cash, bank, or e-wallet opening balance debits the asset ledger account and credits internal opening equity. A positive card debt debits opening equity and credits the card liability. No opening balance is income or expense.

The account, ledger mapping, transaction, immutable revision, journal, postings, audit events, and idempotency response are part of one PostgreSQL transaction. The `Idempotency-Key` is hashed and scoped by owner; same-key/same-body replays the canonical response, while a different body returns 409.

## Balances and history

Balances are read from positive `BIGINT` postings, accumulated as PostgreSQL `numeric` and serialized as decimal strings. Assets use debits minus credits; card liabilities use credits minus debits. No mutable account-balance column exists.

Archive updates `archived_at` and preserves the account, ledger mapping, balance, transactions, and journal history. Default account lists exclude archived accounts; `includeArchived=true` and account detail can read them. Archiving does not reverse a balance or delete history.
