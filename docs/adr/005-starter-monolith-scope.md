# ADR-005: MoniKey Starter is a single-process learning application

- Status: Accepted by project owner
- Date: 2026-10-24
- Owners: MoniKey project owner
- Related plan items: Starter S0–S6 in [`docs/starter/PLAN.md`](../starter/PLAN.md)

## Context

MoniKey V2 accumulated a production-grade product and deployment boundary:
React/Vite, a Fastify API, PostgreSQL, migration and backup jobs, Kubernetes,
Argo CD, TLS, network policies, release digests, and operational runbooks.
That boundary is valid for a future production system but is too large for the
project's entry-level learning goal. The owner needs to understand the whole
application before learning cluster operations.

## Decision

Create MoniKey Starter as a separate branch and implementation boundary.

1. Use one Node application process that serves the web bundle and handles
   application routes.
2. Use one local SQLite file for persistence.
3. Start with one local owner and only accounts, categories, income, expenses,
   balances, and activity history.
4. Keep money exact: integer minor units in storage and explicit parsing at the
   input boundary.
5. Keep the paused V2 deployment and its GitOps history untouched.
6. Defer PostgreSQL, Kubernetes, GitOps, authentication, cards, transfers,
   recurring bills, reports, exports, and production operations until the
   Starter milestones are complete and understood.

## Consequences

The first implementation is easier to run, explain, reset, and test. A local
database reset is a file operation instead of a cluster operation. The Starter
does not provide V2's multi-user isolation, double-entry journal, or production
recovery guarantees; those are explicit future work, not hidden assumptions.

The internal route/domain/repository separation preserves a small upgrade seam
without pretending that the Starter is already a distributed system.

## Alternatives considered

- **Continue V2:** rejected because infrastructure and product scope obscure
  the learning objective.
- **Keep three separate services with Docker Compose:** rejected because it
  preserves the same conceptual deployment boundary that caused confusion.
- **Start directly with Kubernetes/GitOps:** rejected because deployment would
  be learned before the application itself is understood.
- **Use an in-memory store:** rejected because persistence after restart is a
  core learning outcome; SQLite provides persistence without PostgreSQL.
