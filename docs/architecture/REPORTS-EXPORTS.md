# Reports and exports

## Monthly reports

`GET /api/v1/reports/monthly?month=YYYY-MM` aggregates active, non-reversed `INCOME`, `EXPENSE`, and `REFUND` journals. Transfers, card payments, and adjustments do not appear in spending. Refund credits reduce net expenses in the refund month. The response contains exact minor-unit strings for income, net expenses, net cash flow, and category totals.

The Reports screen uses a responsive summary-card layout and an accessible category table with proportional bars. The table is the complete value equivalent of the visual treatment, works in both themes, and masks monetary values with the profile privacy default.

## CSV export

`GET /api/v1/exports/transactions.csv` exports only the authenticated owner’s current transaction revisions. Optional `from` and `to` dates bound the export. Every field is quoted, line endings are stable, and text cells beginning with spreadsheet formula characters, including after leading whitespace/control characters, receive a leading apostrophe before quoting. Numeric minor-unit and revision fields stay exact decimal strings, including negative amounts, so no value is rounded or truncated.

## JSON export

`GET /api/v1/exports/json` returns `monikey-v2.export.v1` with generated timestamp, PHP/Asia-Manila owner metadata, accounts, categories, transactions, recurring bills, and card statements. It deliberately excludes passwords, sessions, CSRF tokens, and other identity secrets. Exports are portable data snapshots; they are not restore commands and never import V1 data.
