# Change log

## Foundation scaffold

- Started a new MoniKey V2 workspace with no V1 application code or financial data.
- Added shared runtime contracts, a PHP minor-unit package, a Fastify readiness endpoint, and a responsive non-financial empty state.
- Added Prisma configuration and Docker Compose services for PostgreSQL, API, web, and explicit migrations.
- Added contributor instructions, issue/PR templates, CI build/typecheck gates, and architecture context.
- Acceptance remains open: no Docker/container runtime is installed in the implementation environment, and real PostgreSQL / API-backed Playwright gates are not yet configured or exercised.
