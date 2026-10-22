# Dashboard summary

The dashboard reads one owner-scoped summary from `GET /api/v1/dashboard/summary`. It does not fetch every transaction and calculate totals in the browser.

## Money rules

- `availableMoneyMinor` is the sum of active `CASH`, `BANK`, and `EWALLET` asset account balances derived from ledger postings.
- `cardDebtMinor` is the sum of active `CREDIT_CARD` liability balances. A card credit balance can be negative.
- `netFinancialPositionMinor` is `availableMoneyMinor - cardDebtMinor`.
- `incomeMinor` and `spendingMinor` cover the server's current `Asia/Manila` month. They include active income and expense journals, including fee postings, and exclude journals whose active posting was reversed.
- All values remain PostgreSQL numeric values serialized as decimal minor-unit strings. No JavaScript floating-point arithmetic is used.

The service also returns the active owner-scoped accounts and the five most recent activity records for the home screen. Account balances and activity continue to use the ledger and current transaction revisions as their source of truth.

## Reconciliation coverage

`apps/api/src/dashboard.integration.test.ts` uses real PostgreSQL and the actual ledger services to verify opening balances, card debt, income, spending, transfer fees, and an edited expense reconcile to the dashboard totals. The browser acceptance suite checks that the authenticated home screen shows those API-backed values and recent activity after a Quick Add expense.
