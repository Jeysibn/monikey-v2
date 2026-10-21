# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, Vite, and TypeScript for an online-first installable PWA; Fastify modular monolith; PostgreSQL; Prisma with versioned SQL migrations; Docker Compose for local development; k3s and Argo CD GitOps in production. These choices are confirmed in the approved master plan.

## Users

The primary user is one individual tracking personal cash, bank accounts, e-wallets, and credit card liabilities. Private family accounts may be added later as independent, non-shared records.

## Product Purpose

MoniKey V2 helps its owner manage daily personal finances without an auxiliary spreadsheet and without doubting balances. The product must make available money, manual transactions, transfers, card debt, and upcoming bills clear and trustworthy.

## Positioning

Financial truth comes from server-owned, immutable, balanced double-entry journals presented through simple consumer-facing actions. V2 starts with an empty financial database and is built from scratch; V1 is a read-only reference.

## Operating Context

The product is used online, with a mobile-first quick-add flow and desktop investigation of activity, statements, and monthly spending. Financial dates use Asia/Manila; displayed and stored currency is PHP. The local development stack is Compose; production is an existing k3s homelab managed with Argo CD.

## Capabilities and Constraints

Launch scope, terminology, routes, security, accounting invariants, and deployment boundaries are fully specified in `MONIKEY_V2_MASTER_PLAN.md`. The product has no public registration, offline write queue, automatic bank connections, or automatic bill payments. Budgets, investments, AI insights, receipt storage, multiple currencies, shared family wallets, and other explicitly excluded capabilities remain out of scope.

## Brand Commitments

Use a premium minimal, royal-blue and deep-navy identity with light and dark modes, accessible contrast, reduced-motion support, and restrained purposeful motion. The full token proposal and interaction constraints are in the approved master plan.

## Evidence on Hand

The approved product and architecture specification is `MONIKEY_V2_MASTER_PLAN.md`. The MoniKey V1 repository and homelab GitOps repository are reference evidence only. V2 has no real user records, financial balances, approved screenshots, or customer claims; do not fabricate them.

## Product Principles

- Trust the numbers: the server is the sole financial source of truth.
- Make everyday use fast on mobile.
- Keep the product beautiful and uncluttered.
- Keep each person's records private and owner-scoped.
- Ship complete, tested vertical slices; a rendered screen is not a finished feature.

## Accessibility & Inclusion

Meet WCAG AA for body text and essential indicators, keep touch targets at least 44 × 44 CSS pixels, support keyboard operation, and honor reduced-motion preferences.
