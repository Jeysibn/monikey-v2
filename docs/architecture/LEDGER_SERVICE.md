# Ledger service contract

P2-04 adds the internal ledger module. It is the only application module allowed to insert `journals` or `postings`; HTTP handlers and account/transaction modules must call its bounded operations and cannot provide arbitrary posting arrays from request bodies.

## Posting contract

- The caller begins one PostgreSQL transaction covering the user action, transaction revision, journal, postings, idempotency response (when applicable), and audit event.
- `postBalancedJournal` checks at least two distinct ledger accounts, positive PostgreSQL `BIGINT` minor units, valid debit/credit directions, and exact BigInt debit/credit equality before writing.
- The service verifies the transaction and all ledger account IDs belong to the authenticated `user_id`, then locks affected financial accounts in deterministic UUID order before inserting the journal, postings, and a safe audit event through the same `PoolClient`.
- PostgreSQL deferred constraint triggers repeat the minimum-leg and balance checks at commit. Append-only triggers reject direct updates/deletes; later corrections append a compensating journal.
- Any validation, ownership, database, or commit failure aborts the caller's entire transaction. No independent balance counter is written.

This is an internal service milestone; it does not expose a public endpoint for arbitrary journal posting. Transaction commands remain responsible for user-facing expense/income/transfer semantics in their later roadmap items.
