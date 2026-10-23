# Ledger service contract

The implemented internal ledger module is the only application module allowed to insert `journals` or `postings`; HTTP handlers and account/transaction modules call its bounded operations and cannot provide arbitrary posting arrays from request bodies. The module is used by opening balances, income, expenses, transfers, refunds, adjustments, card purchases/payments, bill payments, edits, and reversals.

## Posting contract

- The caller begins one PostgreSQL transaction covering the user action, transaction revision, journal, postings, idempotency response (when applicable), and audit event.
- `postBalancedJournal` checks at least two distinct ledger accounts, positive PostgreSQL `BIGINT` minor units, valid debit/credit directions, and exact BigInt debit/credit equality before writing.
- The service verifies the transaction and all ledger account IDs belong to the authenticated `user_id`, then locks affected financial accounts in deterministic UUID order before inserting the journal, postings, and a safe audit event through the same `PoolClient`.
- PostgreSQL deferred constraint triggers repeat the minimum-leg and balance checks at commit. Append-only triggers reject direct updates/deletes; later corrections append a compensating journal.
- Any validation, ownership, database, or commit failure aborts the caller's entire transaction. No independent balance counter is written.

This remains an internal service; it exposes no public endpoint for arbitrary journal posting. Transaction commands own user-facing expense/income/transfer semantics, while account balances and reports derive from persisted journals. The PostgreSQL integration suite exercises balanced posting, ownership, transaction rollback, and process-death rollback; property tests check balanced operation sequences and exact BigInt values.
