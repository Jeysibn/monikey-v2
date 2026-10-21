# ADR-002: Build V2 from scratch

- Status: Accepted by approved product plan
- Date: 2026-10-22
- Owners: MoniKey project owner
- Related plan items: Sections 0, 1, 12, P0-01

## Context

V1 has broader product scope and historical implementation choices that do not define the approved V2 product. Reusing its modules or schema would import features and assumptions the owner explicitly excluded.

## Decision

Create a new V2 repository and database with no V1 application code, routes, providers, schema, or financial data. V1 may be inspected as read-only evidence for proven patterns, test cases, and operational lessons.

## Consequences

V2 starts empty. Production replacement is a separate controlled GitOps cutover, with V1 resources and data retained unless separately approved for removal.

## Alternatives considered

Incremental refactoring or importing V1 modules was explicitly rejected by the approved mandate.
