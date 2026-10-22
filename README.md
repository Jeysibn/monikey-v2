# MoniKey V2

MoniKey V2 is a personal finance tracker being built from scratch. It uses PHP-only financial amounts and a double-entry journal as the source of truth.

## Current state

Phase 0 engineering foundation is implemented and promoted to `main`. Phase 1 mobile-first route shell and design primitives remain in progress pending physical-device review. Phase 2 P2-01 through P2-11 and Phase 3 private-alpha slices are implemented. Phase 4 includes credit-card purchases/payments, manual statements with allocations, recurring bill rules and occurrences, bill payment/skip confirmation, and dashboard bill visibility. Phase 5 reporting, exports, category management, and security controls are implemented locally; release-level UX/QA remains. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for evidence and remaining gates.

## Development

Requirements: Node.js 22.22+ and npm 10.9+. Docker Compose is required for the intended full-stack workflow.

```sh
cp .env.example .env
npm install
docker compose up --build
```

Web: `http://localhost:5173`

The base Compose stack exposes only the web service. For local API/database tests, use the test override below; it exposes the API on `localhost:3000` and PostgreSQL on `localhost:5432`.

API readiness with the test override: `http://localhost:3000/api/v1/health/ready` (liveness: `/api/v1/health/live`)

OpenAPI: `http://localhost:3000/openapi.json`

When the API is running, regenerate the typed client with `npm run api:types`.

## Validation

```sh
npm run validate
npm run test:contracts # requires the local API
```

`npm run validate` is the static, database-free gate: ESLint, strict TypeScript/builds, exact-money and invariant tests, formatting, the tracked-file secret scan, and the dependency audit. Use the Docker-backed commands below for PostgreSQL integration and Playwright acceptance.

`npm run compose:check` validates the base Compose file plus the disposable local test override without starting services.

PostgreSQL-backed API slices can be run locally with `DATABASE_URL` set to the host-mapped Compose database. The card and bill suites are `npm run test:cards --workspace @monikey/api` and `npm run test:bills --workspace @monikey/api`.

The browser acceptance suite uses a live PostgreSQL-backed Compose stack:

```sh
npx playwright install chromium
docker compose -f compose.yaml -f compose.local-test.yaml up --build -d --wait --wait-timeout 180 api web
npx playwright test --workers=1
docker compose -f compose.yaml -f compose.local-test.yaml down --volumes --remove-orphans
```

Use one Playwright worker for the stateful acceptance fixtures. This local run uses the actual API and PostgreSQL; no GitHub Actions run is needed for routine validation.

After the local test override is running and `DATABASE_URL` points at its host PostgreSQL, `npm run test:integration` runs every PostgreSQL-backed API suite sequentially. `npm run test:full-stack` is the one-worker Playwright alias.

The checked-in Compose credentials are for local development only. Production secrets must be managed through the approved GitOps secret path.

## Source of truth

- [`MONIKEY_V2_MASTER_PLAN.md`](MONIKEY_V2_MASTER_PLAN.md): approved product and implementation specification.
- [`docs/architecture/CONTEXT.md`](docs/architecture/CONTEXT.md): architectural boundaries and repository map.
- [`docs/adr/`](docs/adr): material technical decisions.
- [`docs/RELEASE_FLOW.md`](docs/RELEASE_FLOW.md): protected feature → dev → main workflow.
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md): milestone state and evidence.
- [`docs/architecture/CARDS.md`](docs/architecture/CARDS.md): credit-card liability, payments, and statements.
- [`docs/architecture/BILLS.md`](docs/architecture/BILLS.md): recurring bill rules, occurrences, and confirmation flows.
- [`docs/architecture/REPORTS-EXPORTS.md`](docs/architecture/REPORTS-EXPORTS.md): monthly reports and portable export boundaries.
- [`docs/architecture/ARCHITECTURE_AUDIT.md`](docs/architecture/ARCHITECTURE_AUDIT.md): verified boundaries, evidence, and open release gates.
- [`docs/PLAN_COVERAGE_AUDIT.md`](docs/PLAN_COVERAGE_AUDIT.md): requirement-by-requirement master-plan coverage and remaining release gates.
- [`docs/OWNER_REVIEW_CHECKLIST.md`](docs/OWNER_REVIEW_CHECKLIST.md): device, accessibility, financial-flow, security, and owner sign-off handoff.
- [`docs/RELEASE_REVIEW.md`](docs/RELEASE_REVIEW.md): repeatable local accessibility, responsiveness, and performance baseline.
- [`docs/PHASE6_READINESS.md`](docs/PHASE6_READINESS.md): read-only homelab audit and deployment safety boundary.
- [`docs/runbooks/restore.md`](docs/runbooks/restore.md): local PostgreSQL backup and isolated restore procedure.
- [`AGENTS.md`](AGENTS.md): implementation constraints for contributors and coding agents.

V1 is reference-only; no V1 code or financial data is used by this repository.
