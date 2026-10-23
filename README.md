# MoniKey V2

MoniKey V2 is a single-user personal finance tracker built from scratch with a mobile-first React/Vite web/PWA frontend, a Fastify API, and PostgreSQL. It is PHP-denominated and stores money as exact integer minor units serialized as decimal strings; its immutable double-entry journal is the financial source of truth.

## Current state

Phases 0–5 contain substantial implementation and local PostgreSQL/Playwright evidence; physical-device review, independent QA, and owner acceptance remain open where listed in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). Phase 6 is partially implemented: API/web/PostgreSQL workloads, network policies, pre-migration and scheduled backup hooks, monitoring groundwork, V2 TLS/secret bootstrap templates, and a manual six-image release path are present. The 24-resource Kubernetes root and separate cutover Ingress pass local schema validation. Six fresh images built and passed Trivy checks; the PostgreSQL/migration/API/web runtime chain was exercised, and backup rotation/restore evidence is recorded separately. Image publication, age/Argo integration, device CA trust, live cluster validation, storage sizing, and approved cutover remain open. See [`docs/PHASE6_READINESS.md`](docs/PHASE6_READINESS.md).

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

Pull requests run one GitHub Actions `validate` job. Before merging finance or API changes, run the real PostgreSQL integration and API-backed Playwright suites locally as described below; these full-stack checks are intentionally not run on GitHub Actions to conserve minutes.

`npm run compose:check` validates the base Compose file, the local-test override, and the isolated E2E stack without starting services.

Separate [production image build targets](docs/runbooks/production-images.md) are available for local smoke checks. All six targets (API, web, migration, PostgreSQL, backup, and backup-metrics) have local build/test evidence; scans and SPDX inventories are recorded in [`docs/TESTING.md`](docs/TESTING.md). They have not been published or deployed. Phase 6 still requires immutable registry digest verification, approved secret decryption, owner-device CA trust, live cluster validation, and reviewed GitOps release work.

PostgreSQL-backed API slices can be run locally with `DATABASE_URL` set to the host-mapped Compose database. The card and bill suites are `npm run test:cards --workspace @monikey/api` and `npm run test:bills --workspace @monikey/api`.

The browser acceptance suite uses a separate PostgreSQL-backed Compose project. It builds from the current worktree, stores the test database in tmpfs, and leaves the normal development stack running:

```sh
npx playwright install chromium
npm run e2e:stack:up
# Bootstrap the owner and the two disposable users as described in docs/TESTING.md.
PLAYWRIGHT_BASE_URL=http://localhost:18080 PLAYWRIGHT_API_BASE_URL=http://localhost:13000 npm run test:full-stack
npm run e2e:stack:down
```

Use one Playwright worker for the stateful acceptance fixtures. This local run uses the actual API and PostgreSQL; no GitHub Actions run is needed for routine validation. Full seeding commands and PostgreSQL integration instructions are in [`docs/TESTING.md`](docs/TESTING.md).

With the isolated E2E stack running, set `DATABASE_URL='postgresql://monikey:test-only@localhost:15432/monikey_e2e?schema=public'` and run `npm run test:integration` for every PostgreSQL-backed API suite. The same tmpfs database is shared with Playwright, so bring up a fresh stack between stateful suites when fixture data must be pristine. `npm run test:full-stack` is the one-worker Playwright alias.

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
- [`docs/architecture/KUBERNETES_NETWORK_POLICIES.md`](docs/architecture/KUBERNETES_NETWORK_POLICIES.md): V2 pod traffic policy and cluster verification assumptions.
- [`docs/architecture/KUBERNETES_MIGRATION_GATE.md`](docs/architecture/KUBERNETES_MIGRATION_GATE.md): fail-closed migration Job ordering and release gates.
- [`docs/PLAN_COVERAGE_AUDIT.md`](docs/PLAN_COVERAGE_AUDIT.md): requirement-by-requirement master-plan coverage and remaining release gates.
- [`docs/FINANCIAL_ACCEPTANCE_MATRIX.md`](docs/FINANCIAL_ACCEPTANCE_MATRIX.md): test evidence for the master plan's FIN-001–FIN-020 acceptance cases.
- [`docs/OWNER_REVIEW_CHECKLIST.md`](docs/OWNER_REVIEW_CHECKLIST.md): device, accessibility, financial-flow, security, and owner sign-off handoff.
- [`docs/design/LOW_FIDELITY_FLOWS.md`](docs/design/LOW_FIDELITY_FLOWS.md): implementation-grounded phone/desktop layouts and product route flows awaiting owner review.
- [`docs/RELEASE_REVIEW.md`](docs/RELEASE_REVIEW.md): repeatable local accessibility, responsiveness, and performance baseline.
- [`docs/PHASE6_READINESS.md`](docs/PHASE6_READINESS.md): read-only homelab audit and deployment safety boundary.
- [`docs/runbooks/private-ca-bootstrap.md`](docs/runbooks/private-ca-bootstrap.md): V2 private CA/device trust and renewal procedure.
- [`docs/runbooks/phase6-cutover-and-rollback.md`](docs/runbooks/phase6-cutover-and-rollback.md): V1 preservation and owner-gated V2 cutover/rollback.
- [`docs/architecture/OBSERVABILITY.md`](docs/architecture/OBSERVABILITY.md): private API metrics, Grafana dashboard, Prometheus alert rules, and live integration gates.
- [`docs/runbooks/restore.md`](docs/runbooks/restore.md): local PostgreSQL backup and isolated restore procedure.
- [`docs/runbooks/production-backups.md`](docs/runbooks/production-backups.md): production backup rotation implementation, local evidence, and promotion gates.
- [`AGENTS.md`](AGENTS.md): implementation constraints for contributors and coding agents.

V1 is reference-only; no V1 code or financial data is used by this repository.
