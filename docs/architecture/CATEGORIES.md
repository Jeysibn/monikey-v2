# Category lifecycle contract

P2-06 treats categories as stable owner-owned configuration that points to one ledger account. The API exposes `GET/POST /api/v1/categories` and `PATCH /api/v1/categories/:categoryId`. Every query is scoped to the authenticated `user_id`; a missing or foreign category has the shared 404 response.

## Defaults and ledger mapping

When an account is created, the same PostgreSQL transaction idempotently seeds the approved editable defaults: Food, Groceries, Transportation, Shopping, Utilities, Rent/Housing, Subscriptions, Health, Other Expense; Salary, Freelance, Gifts, Other Income. This creates no transactions or balances. Each expense category maps to an `EXPENSE` ledger account and each income category maps to an `INCOME` ledger account. Calling the seed step again preserves existing category IDs, names, sort order, icons, and archive state.

## Custom categories and icons

Category names are trimmed and limited to 60 characters. Duplicate names for the same owner and kind return 409; categories are not physically deleted. Optional icons are stable lowercase tokens (1–32 characters, letters/digits/hyphens) consumed by a fixed UI icon map, never arbitrary SVG or HTML. Sort order is an integer from 0 through 1,000,000.

Create and update requests require session authentication, same-origin/CSRF validation, and an idempotency key. Category insert/update, ledger mapping, audit event, and idempotency response commit atomically. Updates may rename, reorder, change/clear icon, archive, or restore a category.

## Historical records

Archiving sets `archived_at`; active lists omit archived categories unless `includeArchived=true`. Stable IDs and `ledger_accounts` mappings remain. Existing transaction category references therefore continue to identify their original category in history and reports. Future transaction commands must reject archived categories; no such commands are part of P2-06.
