# Local production image build and smoke checks

Updated: 2026-10-24

These image targets prepare V2 for later reviewed release work. Local tags are
not release artifacts. Do not push them to a registry or deploy them as part of
this runbook. Production Kubernetes manifests, SOPS/age wiring, TLS, image
registry publication, provenance, and GitOps promotion remain Phase 6 gates.

## Build the six images

Run from the repository root with Docker available:

```sh
docker build -f apps/api/Dockerfile.production -t monikey-v2-api:local-prod .
docker build -f apps/web/Dockerfile.production -t monikey-v2-web:local-prod .
docker build -f apps/api/Dockerfile.migrate -t monikey-v2-migrate:local .
docker build -f apps/api/Dockerfile.postgres -t monikey-v2-postgres:local-prod .
docker build -f apps/api/Dockerfile.backup -t monikey-v2-backup:local-prod .
docker build -f apps/backup-metrics/Dockerfile -t monikey-v2-backup-metrics:local-prod .
```

These are the six image identities referenced by the workload manifests: API,
web, migration, PostgreSQL, backup, and backup metrics. A local tag is only a
build target; production manifests must still be rendered with reviewed,
published immutable digests before any GitOps change.

The API/web image builds use Node 22.22 and Nginx 1.29.3 base image digests.
Runtime stages refresh and upgrade Alpine packages at build time. The API
runtime contains production dependencies, runs as `node`, and exposes a
liveness health check. The migration image runs as `node`. The web image serves
the compiled Vite output with Nginx on port 8080 as UID 101, proxies `/api/` to
the `api` service, and sets CSP, frame, MIME, referrer, and permissions headers.
Nginx access logs contain the URI path but omit query arguments. API request
logs redact the request URL to avoid retaining Activity search terms. HSTS is
not set until the approved private HTTPS hostname and device trust are verified.

## Validate the production migration image

Use a disposable database on the local test stack. The example assumes the
Compose network is `monikey-v2_default` and the database service is `db`; inspect
`docker network ls` and adapt the local network name if Compose selected a
different project name.

```sh
docker compose -f compose.yaml -f compose.local-test.yaml exec -T db \
  createdb -U monikey monikey_prod_smoke
docker run --rm --network monikey-v2_default \
  -e "DATABASE_URL=${DATABASE_URL:?Set DATABASE_URL from your local environment}" \
  monikey-v2-migrate:local
docker compose -f compose.yaml -f compose.local-test.yaml exec -T db \
  psql -U monikey -d monikey_prod_smoke -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'journals', 'card_statements', 'bills')"
docker compose -f compose.yaml -f compose.local-test.yaml exec -T db \
  dropdb -U monikey monikey_prod_smoke
```

The schema query should return `4`. Always drop the disposable database after
the check.

## Validate the production web and API images

The current disposable local Compose API and database can be reused for
read-only web smoke checks. Start the web image on the same Compose network:

```sh
docker run -d --name monikey-v2-web-smoke \
  --network monikey-v2_default -p 18080:8080 monikey-v2-web:local-prod
curl --fail --silent --show-error --dump-header - \
  http://localhost:18080/ -o /dev/null
curl --fail --silent --show-error --dump-header - \
  http://localhost:18080/api/v1/health/ready -o /dev/null
curl --fail --silent --show-error --dump-header - \
  http://localhost:18080/sw.js -o /dev/null
PLAYWRIGHT_BASE_URL=http://localhost:18080 npx playwright test \
  --project=desktop-chromium --workers=1 \
  --grep='renders the honest home preview|routes, deep links|quick add action and theme control|unknown browser routes|browser reaches the live API backed by PostgreSQL'
docker rm -f monikey-v2-web-smoke
```

The targeted browser tests are read-only and exercise route fallback, assets,
and API proxying. Confirm `/sw.js` includes `Cache-Control: no-cache`. Do not
run the financial write journeys against a shared or production database. To
verify API log redaction, request a health URL with a harmless unique query
marker and confirm the marker is absent from `docker logs` for the API and web
containers. To verify the API image itself, run it on the Compose network with
`DATABASE_URL` set to the disposable database and `APP_ORIGIN` set to the
intended local test origin, then check `/api/v1/health/ready`.

## Recorded local evidence

On 2026-10-23 the three image builds succeeded. The migration image applied all
five migrations to a fresh disposable PostgreSQL database and the four-table
verification returned `4`; that database was removed. The API image returned
`{"status":"ok","database":"connected"}` from readiness and ran as the
`node` user. The web image ran as UID 101, returned CSP and browser security
headers on both the app and service-worker responses, served `/sw.js` with
`Cache-Control: no-cache`, omitted a unique query marker from API and Nginx
access logs, and passed five targeted desktop Playwright tests. No image was
published, no GitHub Actions run was started, and no production resource was
changed.

## Local vulnerability scan and SBOM evidence

On 2026-10-23, Trivy `0.76.0` scanned the final local API, web, and migration
image IDs for HIGH and CRITICAL vulnerabilities. All three returned zero
findings across their detected OS and language package targets. The scanner
used its local database, whose metadata was valid through
`2026-10-23T13:15:26Z`; the final migration scan produced no missing-detail
warning. The images are local build artifacts, so publication still requires
scanning the exact registry digests.

The API runtime copies only the Node executable, upgrades Alpine packages,
and removes npm/corepack. The web runtime refreshes Alpine and returns zero
OS-package findings. The migration target uses a separate install stage for
Prisma `7.10.1` and `dotenv` `16.6.1`, omits optional packages (including the
esbuild binary), and copies only the required Prisma dependency tree into a
nonroot Node runtime. It also upgrades Alpine packages and removes npm/corepack.
This removes the bundled esbuild Go standard library and npm's bundled tools
from the final migration image while preserving `prisma migrate deploy`.

The final local image IDs and Trivy outcomes are:

| Image     | Local image ID                                                            | HIGH | CRITICAL |
| --------- | ------------------------------------------------------------------------- | ---: | -------: |
| API       | `sha256:04b4cefda53e7057c6cf27753eeb18111a52cbbd60a5f74f9bb8949da08ad77e` |    0 |        0 |
| Web       | `sha256:602f7bb0369508662d1a24d18cc9af3d250d49dbd241a43a25a6ab4e592b3d8d` |    0 |        0 |
| Migration | `sha256:3dda8d5dd5ccb6f3d031a57bed0496c0ccfc3c8f96e0d52b22569eb4da3f3877` |    0 |        0 |

Syft `1.55.0` generated SPDX JSON SBOMs for those images: 245 API, 71 web,
and 160 migration packages. The files were kept under `/tmp` and not committed.
Both scanner images were pinned by digest locally. Release automation still
needs to scan published immutable image digests, retain SBOMs and provenance as
artifacts, and gate publication on reviewed findings. No image was published
or deployed, and no GitHub Actions run was started.
