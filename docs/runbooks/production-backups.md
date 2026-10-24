# Production PostgreSQL backup workflow

This package implements the backup command, retention policy, metrics file, and
CronJob template for MoniKey V2. It does not apply anything to the homelab.
The accepted policy stores daily custom-format PostgreSQL dumps on the same
physical host/failure domain as the database.

## Contents

- `deploy/kubernetes/backup/pg-backup-rotate.sh` creates and validates a custom
  archive, checksum, and redacted metadata in a temporary directory, then
  atomically renames that directory into the daily snapshot set.
- The first successful run in each UTC week creates a weekly hard link to the
  daily archive. Both directories are on the same PVC, so the weekly retention
  copy does not duplicate archive bytes.
- Daily retention defaults to seven snapshots and weekly retention to four.
  Rotation runs only after the new daily archive and any new weekly link are
  published successfully. A failed dump, archive validation, or weekly link
  exits before pruning.
- Files and directories are mode `0600` and `0700`; the job runs as the
  PostgreSQL image's non-root UID/GID 70. Stdout contains status, timestamp,
  size, and checksum only. PostgreSQL utility stderr is kept in the temporary
  directory and removed during cleanup.
- `metrics.prom` atomically records last-run success, last-known-good time and
  size, and backup volume capacity/available bytes. The file is not scraped by
  the current homelab; wire it to an approved textfile exporter or equivalent
  before enabling the backup metric alerts.
- `cronjob.yaml` schedules a daily run at 02:00 in the Kubernetes controller's
  timezone, forbids overlap, limits retry/history, disables service-account
  token mounting, and applies a restricted non-root security context.
- `pre-migration-job.yaml` runs the same backup image and script as an Argo CD
  Sync hook at wave 1, after PostgreSQL is healthy and before the migration
  hook at wave 2. It uses the same client Secret, backup PVC, network-policy
  identity, and restricted UID 70 runtime. Archive validation failure exits
  nonzero and blocks migration and later sync waves. Successful hook Jobs are
  deleted after completion so each sync creates a new backup attempt.
- Every invocation takes a nonblocking `flock` on `.backup.lock` before
  reading state or changing metrics, snapshots, and retention. CronJob
  `Forbid` covers scheduled runs; the shared-volume lock also serializes the
  migration hook against scheduled runs. The kernel releases the lock if its
  process exits or is killed.
- `kustomization.yaml` sets the intended namespace to `monikey-v2`. The backup
  script is packaged into the dedicated image so its contents are covered by
  the image digest and SBOM.

The local `Dockerfile.backup` uses official PostgreSQL 17.11 / Alpine 3.24.3,
pinned to digest
`sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb`.
It removes the upstream `gosu` binary because the CronJob runs the script
directly as UID 70 and bypasses the upstream entrypoint. Trivy 0.76.0 reported
zero HIGH/CRITICAL findings for this derived local image. The upstream base
image itself still contains the unused `gosu` binary with 26 HIGH/CRITICAL
findings, so the CronJob references the derived backup image as a release
placeholder. Before promotion, publish the derived image after validated
`main`, scan that exact image, generate its SPDX SBOM, and replace the
placeholder with its immutable registry digest.

## Required before GitOps promotion

1. Measure representative custom-format archive sizes and available Longhorn
   capacity, then create a dedicated `monikey-v2-backups` PVC. Capacity planning
   must account for up to eleven retained archive paths (seven daily plus four
   weekly), the largest in-progress dump while retention pruning has not yet
   run, metadata/filesystem overhead, observed database growth across the
   retention window, and an explicit operational reserve. Weekly archives are
   hard links to daily archive files on the same PVC, so the same archive
   consumes data blocks once; count unique archive files rather than paths.
   Validate this estimate with a production-like dump and the actual Longhorn
   capacity before setting the PVC request. Keep it separate from the
   PostgreSQL data PVC; it remains on the accepted same-host failure domain.
2. Create `monikey-v2-postgres-client` through the approved encrypted secret
   workflow with `host`, `database`, `username`, and `password` keys. Do not
   create or commit a plaintext Secret.
3. Confirm the namespace choice, CronJob timezone/schedule, PVC mount ownership
   and hard-link support, PostgreSQL Service/DNS, and NetworkPolicy egress to
   port 5432 against the actual cluster.
4. Configure the approved exporter to scrape `/backups/metrics.prom` and verify
   the `monikey_backup_*` series before enabling its Prometheus alerts.
5. Publish the locally validated derived backup image and pin its registry
   digest, validate with
   the cluster's Kubernetes/Kustomize versions, then
   run a production-like CronJob and isolated restore drill before cutover.

The schedule is explicitly pinned to `Etc/UTC`. The audited GitOps bootstrap
script targets K3s `v1.36.3+k3s1`, whose Kubernetes API supports CronJob
timezones; this source setting does not prove the running cluster version.
Remaining live checks include available storage, current namespace and network
policy, Secret decryption, exporter wiring, the running cluster version, and a
V2 database Service. The manifest references the future PVC and Secret by
design; it is not deployable until they exist.

## Local Docker verification

The disposable test procedure is recorded in `docs/development/TESTING.md`. In summary, a
fresh tmpfs Compose database was backed up by the non-root image, restored into
a separately created database, checksum/archive listing were checked, daily
and weekly retention were exercised, and a forced connection failure preserved
the previous seven known-good daily snapshots. A follow-up ran the image with
UID 70, read-only root, dropped capabilities, and no-new-privileges: archive
validation passed; a connection failure marked the run unsuccessful while
retaining the prior success timestamp and archive. The isolated database and
Docker volume were removed after verification. No production data or Actions
minutes were used.

A follow-up concurrency check held `.backup.lock` from a separate container
against the same mounted volume. The competing restricted backup exited 75
with `stage=already_running` before state or metrics updates. After the holder
was forcibly removed, the backup ran successfully, confirming the kernel lock
does not remain stale after process termination. The test volume was removed.

Never restore over the running database. Use `docs/runbooks/restore.md` for the
isolated restore procedure, row-level acceptance checks, and recovery records.
