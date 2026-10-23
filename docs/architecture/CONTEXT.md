# MoniKey V2 architecture context

## Product boundary

MoniKey V2 is a clean-room implementation. The V1 repository is read-only evidence for proven patterns, test cases, and operational lessons. Do not copy its application modules, schema, routes, provider integrations, or UI. V2 starts with an empty database and is the only product scope described here.

The approved source is [`MONIKEY_V2_MASTER_PLAN.md`](../../MONIKEY_V2_MASTER_PLAN.md). `MUST` items are release requirements. `SHOULD` items are defaults unless an approved ADR explains a deviation. `LATER` and explicitly excluded capabilities are out of scope.

## Architecture decisions already approved

- React, Vite, TypeScript, and an online-first installable PWA.
- Fastify modular monolith with one API process and PostgreSQL.
- Direct PostgreSQL access through `pg` for runtime queries and transactional domain operations; Prisma schema/configuration and versioned SQL migrations are used for database tooling, not runtime CRUD.
- Exact PHP minor units backed by PostgreSQL `BIGINT`; JSON carries minor amounts as decimal strings.
- Double-entry immutable journals are the only source of financial truth.
- User-scoped ownership, private authentication, Asia/Manila financial dates.
- Docker Compose for local development; k3s + Argo CD GitOps for production.
- No worker, Redis, mock finance runtime, or V1 data migration.

## Repository boundaries

```text
apps/web        React client and PWA surface
apps/api        Fastify API and module composition
packages/money  Exact amount parsing, arithmetic, and formatting
packages/contracts Shared runtime API contracts
prisma/         Prisma schema and versioned SQL migrations
e2e/            Browser journeys against the actual API and PostgreSQL
deploy/         Kubernetes/Kustomize templates and release boundaries
monitoring/     Prometheus rules and Grafana dashboard source
scripts/        Local validation, backup, release, and secret-bootstrap tooling
docs/           Portable architecture, ADRs, runbooks, and QA evidence
```

The ledger module will own journal writes. Transactions and bills will orchestrate domain operations through it; routes and frontend code must not write postings or independently calculate balances.

## Current implementation state

The repository now contains the authenticated React/Vite PWA, Fastify API, PostgreSQL schema and migrations, exact-money and API-contract packages, ledger-backed account/transaction/card/bill/report flows, owner-scoped exports and settings, and Docker Compose environments. Local validation covers strict typing/builds, PostgreSQL integration, and desktop/mobile Playwright journeys against the actual API. Phase 6 also has Kubernetes, backup, monitoring, and release templates with local validation.

The roadmap and remaining acceptance gates are tracked in `docs/IMPLEMENTATION_STATUS.md` and `docs/PLAN_COVERAGE_AUDIT.md`. Physical-device and owner acceptance, independent QA, image publication, owner-managed secrets/device trust, live cluster checks, and approved cutover remain open. No V1 code or financial data has been imported.

## Change control

Record material architecture deviations in `docs/adr/` and obtain owner approval before implementation. Keep critical product and technical documentation in this repository; Obsidian is the project journal and index, not the only source of truth.
