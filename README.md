# MoniKey V2

MoniKey V2 is a personal finance tracker being built from scratch. It uses PHP-only financial amounts and a double-entry journal as the source of truth.

## Current state

This repository is in the foundation milestone. It includes workspace scaffolding, an API readiness endpoint, an empty web shell without demo financial data, and local Compose definitions. The ledger, identity flows, and financial features are not implemented yet.

## Development

Requirements: Node.js 22.12+ and npm 10.9+. Docker Compose is required for the intended full-stack workflow.

```sh
cp .env.example .env
npm install
docker compose up --build
```

Web: `http://localhost:5173`

API readiness: `http://localhost:3000/api/v1/health`

OpenAPI: `http://localhost:3000/openapi.json`

The checked-in Compose credentials are for local development only. Production secrets must be managed through the approved GitOps secret path.

## Source of truth

- [`MONIKEY_V2_MASTER_PLAN.md`](MONIKEY_V2_MASTER_PLAN.md): approved product and implementation specification.
- [`docs/architecture/CONTEXT.md`](docs/architecture/CONTEXT.md): architectural boundaries and repository map.
- [`docs/adr/`](docs/adr): material technical decisions.
- [`docs/RELEASE_FLOW.md`](docs/RELEASE_FLOW.md): protected feature → dev → main workflow.
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md): milestone state and evidence.
- [`AGENTS.md`](AGENTS.md): implementation constraints for contributors and coding agents.

V1 is reference-only; no V1 code or financial data is used by this repository.
