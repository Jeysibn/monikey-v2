# MoniKey V2 agent instructions

- Build V2 from scratch. V1 is a read-only reference; never import its product code or data model.
- Follow `MONIKEY_V2_MASTER_PLAN.md` and accepted ADRs. Do not add excluded features.
- Never use floating-point for stored money, calculations, or API money totals. Serialize minor units as decimal strings.
- One ledger service owns journal postings; every journal must balance and posted journal rows are immutable.
- Every query and mutation is user-scoped. Do not expose whether another user's resource exists.
- Financial E2E acceptance requires real PostgreSQL and the actual API; do not add a mock finance adapter.
- Keep the interface mobile-first, accessible, blue-led, light/dark, and reduced-motion aware.
- Keep repository docs authoritative for portable technical/product knowledge. Update the Obsidian MoniKey V2 project journal for substantive work.
- Never claim a check passed unless it ran successfully. Do not deploy, promote GitOps changes, or remove V1 resources without explicit owner approval.
