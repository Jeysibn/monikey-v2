# MoniKey Starter implementation plan

## Guiding rule

Every milestone must leave a runnable, understandable application. Do not add
an infrastructure layer or product feature until the previous milestone is
working and documented.

## Scope for the first usable version

### Included

- one local user with no sign-in ceremony;
- accounts with a name and opening balance;
- income and expense categories;
- income and expense transactions;
- a current balance per account and in total;
- a transaction list with simple date filtering;
- edit and delete for local records; and
- exact money stored as integer minor units.

### Explicitly deferred

- PostgreSQL and Kubernetes;
- GitOps, Argo CD, TLS, monitoring, and backup rotation;
- public or multi-user authentication;
- transfers, credit cards, bills, reports, exports, and audit journals;
- offline writes, synchronization, notifications, and external integrations.

## Milestones

### S0 — Documentation and boundary (current)

- Accept the Starter scope ADR.
- Document the top-level design and user flows.
- Keep the V2 deployment paused and untouched.

**Done when:** a new developer can explain the app in five minutes without
reading Kubernetes manifests.

### S1 — Single-process foundation

- Create one application entry point.
- Serve the web UI and API from that application.
- Add SQLite connection and migrations.
- Add a health endpoint and a friendly empty state.

**Done when:** `npm run dev` starts one app and a local database file is created
without Docker.

### S2 — Accounts and categories

- Create, rename, and archive accounts.
- Create, rename, and archive income/expense categories.
- Validate names and opening balances at the application boundary.

**Done when:** the first account and categories survive a process restart.

### S3 — Transactions

- Add income and expense records.
- Store amounts as signed integer minor units, never floating point.
- Calculate balances from persisted transactions.
- Add edit and delete with a clear confirmation.

**Done when:** adding an expense decreases the expected account balance and the
result remains correct after reload.

### S4 — Daily dashboard

- Show total balance, account balances, and recent activity.
- Add a simple date filter.
- Add loading, empty, validation, and database-error states.

**Done when:** the daily workflow can be completed on a phone-sized viewport
without a documentation lookup.

### S5 — Confidence and cleanup

- Add unit tests for money parsing and balance calculation.
- Add API tests for account/category/transaction behavior.
- Add one browser test for the first-run and expense flows.
- Write a short troubleshooting guide.

**Done when:** tests describe the same behavior the user sees and a new
developer can recover from a reset database.

### S6 — Optional next step

Only after S5 is accepted, choose one next step:

- package the app for a simple local Docker run; or
- migrate the database from SQLite to PostgreSQL.

Kubernetes and GitOps are not automatic next steps.

## Definition of done for each feature

- The feature has one short user story.
- The data shape and validation are documented.
- The UI, application rule, and persistence change together.
- A happy path and one failure path are tested.
- The feature can be explained without infrastructure terminology.
