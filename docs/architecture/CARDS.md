# Credit cards

Credit cards are liability accounts. Their `balanceMinor` is current outstanding debt, while `creditLimitMinor` is a display and utilization reference; unused limit never contributes to Available Money.

## Purchases

An expense may use a credit card source. The category receives a debit and the card liability receives a credit. The purchase is a normal `EXPENSE` transaction and appears in Activity.

## Payments

`POST /api/v1/credit-cards/:cardAccountId/payments` is the dedicated payment command. It locks the card and funding account in deterministic order, debits card liability, credits the funding asset, and writes one `CARD_PAYMENT` transaction. It never creates another expense. Funding from another credit card is rejected; negative funding requires explicit confirmation.

## Statements

Statements are manually entered issuer snapshots. They store statement and payment due dates, optional period dates, the actual amount due, and an optional note. They do not create ledger postings. A payment can allocate part or all of its amount to one statement; allocations are positive, owner-scoped, unique per payment/statement pair, and cannot exceed the remaining statement amount. Editing a statement only changes the snapshot and audit event.

## UI

Account detail shows outstanding debt, limit, utilization, and over-limit state. The payment form selects an asset funding account and exact PHP amount. Statement history labels issuer-entered amounts and shows allocated and remaining due values.
