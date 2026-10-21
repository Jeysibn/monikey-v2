# Validation and acceptance

## Local checks

Run `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run format:check`, and `npm audit` from the repository root. Unit tests use Node's test runner through `tsx` and do not require a database.

## PostgreSQL-backed browser acceptance

The browser suite must use the real API and real PostgreSQL; do not replace it with a mock finance adapter.

```sh
npx playwright install chromium
docker compose up --build -d --wait --wait-timeout 180 api web
npm run test:e2e
docker compose down --volumes --remove-orphans
```

Compose starts PostgreSQL, runs the migration container to completion, waits for the API readiness endpoint, then serves the web client. The suite covers desktop and Pixel 7 mobile emulation, honest empty-state content, DB readiness through the browser proxy, invalid request error serialization, and the development-only valid request probe. CI installs Chromium system dependencies and runs the same Compose-backed suite.

The separate `test` Compose profile exposes an ephemeral PostgreSQL instance for focused integration suites. Add integration suites when the first persistent domain schema lands.

## Environment limitations

The implementation environment currently has no Docker/container runtime or local PostgreSQL tools. In this environment, do not claim the Compose-backed browser suite passed. GitHub Actions is the current execution environment for that gate.
