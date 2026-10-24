# MoniKey Starter

Status: planned on branch `starter/monikey-starter`.

This is the entry-level version of MoniKey. It is intentionally smaller than
MoniKey V2 and is designed to be understandable before it is deployable.

## What this version is

MoniKey Starter is a private, single-user money tracker with:

- one Node application process;
- one local SQLite database file;
- a small web UI served by the same application;
- accounts, categories, income, expenses, and a balance dashboard; and
- exact integer minor-unit money values.

It is not a three-service production platform. It has no Kubernetes, Argo CD,
GitOps, PostgreSQL, background workers, card accounting, recurring bills,
multi-user identity, PWA/offline sync, or production backup system.

## Read in this order

1. [Starter plan](PLAN.md)
2. [Top-level design](TLD.md)
3. [User flows and intended use](FLOWS.md)
4. [Starter scope ADR](../adr/005-starter-monolith-scope.md)

The existing V2 architecture and deployment documentation remains historical
reference material. It is not the implementation target for this branch.

## Success criteria

The Starter is complete when a new developer can:

1. run one documented command;
2. create an account and category;
3. record an income or expense;
4. see the balance update after reload; and
5. understand where the UI, domain rules, and database code live.

## Current boundary

This branch currently contains the plan only. No Starter code or deployment
has been added yet. The paused V2 cluster is out of scope and will not be
changed by this branch.
