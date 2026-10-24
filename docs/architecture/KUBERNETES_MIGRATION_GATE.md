# Kubernetes migration rollout gate

Updated: 2026-10-23

## Job ordering

`deploy/kubernetes/backup/pre-migration-job.yaml` takes and validates a fresh
PostgreSQL archive as an Argo CD `Sync` hook at wave 1. The migration is a
`Sync` hook at wave 2. The intended application sync ordering is:

| Wave | Resources                             | Required health before next wave                              |
| ---- | ------------------------------------- | ------------------------------------------------------------- |
| 0    | V2 PostgreSQL Service and StatefulSet | PostgreSQL readiness probe succeeds                           |
| 1    | Pre-migration backup Job              | Archive, checksum, and `pg_restore --list` validation succeed |
| 2    | This migration Job                    | `prisma migrate deploy` exits 0                               |
| 3    | V2 API Deployment                     | Migration hook has succeeded                                  |
| 4    | V2 web Deployment                     | API wave is healthy                                           |
| 5    | Backup metrics Deployment and Service | Exporter becomes ready                                        |
| 6    | Separately reviewed cutover Ingress   | Included only in the explicit cutover change                  |

The migration is a Sync hook rather than a PreSync hook because a new V2
PostgreSQL StatefulSet must be created and become healthy before migrations can
connect. `backoffLimit: 0` and `activeDeadlineSeconds: 900` make a failed or
stalled command fail the hook without retrying it in the Job. The hook's
nonzero result blocks later sync waves. `BeforeHookCreation` removes a prior
Job when a later sync starts; successful Job state remains until then.

The pre-migration backup hook uses the same digest-pinned backup image, client
Secret, PVC, and restricted UID/GID 70 runtime as the scheduled backup. It runs
the backup script directly. Its `backoffLimit: 1` permits one retry; a second
failure blocks the migration and later waves. Successful hook Jobs are removed
after completion so a later sync can create a fresh backup Job.

The pod runs as UID/GID 1000, has a read-only root filesystem, no service
account token, no Linux capabilities, the runtime-default seccomp profile, and
only an in-memory `/tmp` mount. `DATABASE_URL` comes from the future encrypted
`monikey-v2-runtime-secrets` Secret.

## Current limitations

- The GHCR image field is an explicit release placeholder. Replace it with the
  immutable migration-image digest produced from a validated `main` release;
  this Kustomize package must not be promoted in its current state.
- PostgreSQL, pre-migration backup, migration, API/web, and backup-metrics
  resources now exist under `deploy/kubernetes/`; the separate cutover Ingress
  is wave 6. The complete root currently renders 24 resources and has local
  Kubernetes 1.30/cert-manager schema validation.
- The locally rebuilt image passed Trivy 0.76.0 with zero HIGH/CRITICAL
  findings; Syft 1.33.0 generated an SPDX 2.3 SBOM with 160 packages. Repeat
  both checks against the published digest and retain those artifacts.
- Secret bootstrap, compatibility window, destructive rollback compatibility,
  exact six-image release digest set and live Argo health/wave behavior are
  release gates. A local restricted-container smoke verified backup success
  and nonzero failure behavior, but only a live Argo sync can verify the hook
  ordering. The release manifest records the latest Prisma migration
  directory as `migration_schema_version` and rejects a value that differs from
  the checked-out source migration set. `npm run render:release-manifests`
  consumes a retained manifest, renders all six digest pins into a temporary
  Kustomize copy, checks for missing/extra images, and writes a candidate
  outside the GitOps checkout. The local test validates Prisma execution and
  idempotent rerun, but does not simulate Argo synchronization.
- CPU and memory requests/limits are starter values and need measurement on the
  selected environment.

See `docs/runbooks/production-images.md`, `docs/release/PHASE6_READINESS.md`, and the
master-plan P6-05 acceptance criteria.
