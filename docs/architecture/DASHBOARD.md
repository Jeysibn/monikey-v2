# Dashboard summary

The dashboard reads one owner-scoped summary from `GET /api/v1/dashboard/summary`. It does not fetch every transaction and calculate totals in the browser.

## Money rules

- `availableMoneyMinor` is the sum of active `CASH`, `BANK`, and `EWALLET` asset account balances derived from ledger postings.
- `cardDebtMinor` is the sum of active `CREDIT_CARD` liability balances. A card credit balance can be negative.
- `netFinancialPositionMinor` is `availableMoneyMinor - cardDebtMinor`.
- `incomeMinor` and `spendingMinor` cover the server's current `Asia/Manila` month. They include active income and expense journals, including fee postings, and exclude journals whose active posting was reversed.
- All values remain PostgreSQL numeric values serialized as decimal minor-unit strings. No JavaScript floating-point arithmetic is used.

The service also returns the active owner-scoped accounts, up to five upcoming or overdue bill occurrences in the next three months, and the five most recent activity records for the home screen. Occurrences are generated through the same deterministic Bills service used by `/bills`; paid and skipped reminders are excluded from the upcoming widget. Account balances, card debt, bill amounts, and activity continue to use owner-scoped API records, with ledger postings as the source of truth for money that has moved.

## Reconciliation coverage

`apps/api/src/dashboard.integration.test.ts` uses real PostgreSQL and the actual ledger services to verify opening balances, card debt, income, spending, transfer fees, and an edited expense reconcile to the dashboard totals. Local browser acceptance checks the authenticated home screen, card liability hierarchy, upcoming-bill panel, and Bills route against the actual API and PostgreSQL.
