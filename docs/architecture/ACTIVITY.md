# Unified Activity

Activity is the owner-scoped read surface over current transaction revisions. The API provides `GET /api/v1/transactions` with deterministic `(occurredOn, createdAt, id)` cursor pagination and filters for note search, date range, kind, status, account, and category.

The P3-04 screen keeps those filters in the URL so reloads and deep links preserve the requested view. It loads account and category labels from the same owner-scoped endpoints, appends cursor pages without offset pagination, and links each row to `/app/transactions/:transactionId`.

## Detail and correction rules

- Detail reads use the owner-scoped transaction and audit endpoints.
- Posted income and expense records can be edited with a required reason. The API reverses the active journal, writes the replacement revision, and posts the replacement journal atomically.
- Any posted transaction can be reversed with a required reason. The API creates a compensating reversal journal and marks the transaction void; it never rewrites or deletes the original journal.
- The detail screen displays immutable revision history and does not expose another user's record when an ID is guessed.

The browser acceptance flow covers filter deep-link reload, detail editing, reversal, and the resulting audit-safe success states against real PostgreSQL and the actual API.
