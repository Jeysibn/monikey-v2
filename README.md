# MoniKey V2

MoniKey V2 is a personal finance tracker being built from scratch. It uses PHP-only financial amounts and a double-entry journal as the source of truth.

## Current state

Phase 0 engineering foundation is implemented and promoted to `main`. Phase 1 mobile-first route shell and design primitives remain in progress pending physical-device review. Phase 2 P2-01 through P2-11 are implemented; P3-01 adds private sign-in and guided first-account setup with a ledger-backed opening balance, P3-02 adds the authenticated Quick Add expense, income, and transfer flow, P3-03 adds the ledger-derived dashboard summary and home screen, P3-04 adds unified filtered Activity with detail edits and reversals, P3-05 adds account management and archived history, and P3-06 adds a shell-only installable PWA with explicit offline write blocking. Phase 3 private-alpha vertical slices continue with acceptance work. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for evidence and remaining gates.

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

When the API is running, regenerate the typed client with `npm run api:types`.

## Validation

```sh
npm run typecheck
npm run test:unit
npm run test:invariants
npm run build
npm run format:check
npm audit
```

The browser acceptance suite uses a live PostgreSQL-backed Compose stack:

```sh
npx playwright install chromium
docker compose up --build -d --wait --wait-timeout 180 api web
npm run test:e2e
docker compose down --volumes --remove-orphans
```

The e2e suite is also run in GitHub Actions. It cannot be run in an environment without Docker.

The checked-in Compose credentials are for local development only. Production secrets must be managed through the approved GitOps secret path.

## Source of truth

- [`MONIKEY_V2_MASTER_PLAN.md`](MONIKEY_V2_MASTER_PLAN.md): approved product and implementation specification.
- [`docs/architecture/CONTEXT.md`](docs/architecture/CONTEXT.md): architectural boundaries and repository map.
- [`docs/adr/`](docs/adr): material technical decisions.
- [`docs/RELEASE_FLOW.md`](docs/RELEASE_FLOW.md): protected feature → dev → main workflow.
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md): milestone state and evidence.
- [`AGENTS.md`](AGENTS.md): implementation constraints for contributors and coding agents.

V1 is reference-only; no V1 code or financial data is used by this repository.
