# MoniKey V2 architecture context

## Product boundary

MoniKey V2 is a clean-room implementation. The V1 repository is read-only evidence for proven patterns, test cases, and operational lessons. Do not copy its application modules, schema, routes, provider integrations, or UI. V2 starts with an empty database and is the only product scope described here.

The approved source is [`MONIKEY_V2_MASTER_PLAN.md`](../../MONIKEY_V2_MASTER_PLAN.md). `MUST` items are release requirements. `SHOULD` items are defaults unless an approved ADR explains a deviation. `LATER` and explicitly excluded capabilities are out of scope.

## Architecture decisions already approved

- React, Vite, TypeScript, and an online-first installable PWA.
- Fastify modular monolith with one API process and PostgreSQL.
- Prisma for ordinary CRUD and versioned SQL migrations for constraints it cannot express.
- Exact PHP minor units backed by PostgreSQL `BIGINT`; JSON carries minor amounts as decimal strings.
- Double-entry immutable journals are the only source of financial truth.
- User-scoped ownership, private authentication, Asia/Manila financial dates.
- Docker Compose for local development; k3s + Argo CD GitOps for production.
- No worker, Redis, mock finance runtime, or V1 data migration.

## Initial repository boundaries

```text
apps/web        React client and PWA surface
apps/api        Fastify API and module composition
packages/money  Exact amount parsing, arithmetic, and formatting
packages/contracts Shared runtime API contracts
prisma/         Prisma schema and versioned SQL migrations
docs/           Portable architecture, ADRs, runbooks, and QA evidence
```

The ledger module will own journal writes. Transactions and bills will orchestrate domain operations through it; routes and frontend code must not write postings or independently calculate balances.

## Foundation status

The repository currently contains an npm workspace scaffold, a readiness endpoint, OpenAPI output, a non-financial empty-state web shell, shared money and health-contract packages, and Compose definitions. This is an in-progress P0 foundation, not a completed vertical slice. Docker, PostgreSQL CLI utilities, and a container runtime were unavailable when setup began, so Compose and database behavior have not been validated here.

## Change control

Record material architecture deviations in `docs/adr/` and obtain owner approval before implementation. Keep critical product and technical documentation in this repository; Obsidian is the project journal and index, not the only source of truth.
