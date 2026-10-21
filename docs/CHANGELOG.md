# Change log

## Foundation scaffold

- Started a new MoniKey V2 workspace with no V1 application code or financial data.
- Added shared runtime contracts, a PHP minor-unit package, a Fastify readiness endpoint, and a responsive non-financial empty state.
- Added Prisma configuration and Docker Compose services for PostgreSQL, API, web, and explicit migrations.
- Added contributor instructions, issue/PR templates, CI build/typecheck gates, and architecture context.
- Created the public `Jeysibn/monikey-v2` repository with protected `dev` and `main`, required CI/CodeQL checks, and feature → dev → main pull request flow.
- Added a standard API error envelope, generated OpenAPI TypeScript client, exact-money unit tests, and a Compose-backed desktop/mobile browser acceptance workflow.
- Local Docker is unavailable, so the Compose-backed PostgreSQL/API e2e acceptance must run in GitHub Actions.
