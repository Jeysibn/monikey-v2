# Phase 6 cutover and rollback runbook

Status: preparation only. This document describes a future owner-approved
procedure; it has not been executed. The audited GitOps source is
`/home/jeysi/homelab-gitops` at commit
`2369afce6161f8c3f3f970cf1e484e44b3227df9`. No live cluster state was
available during authoring.

## Safety boundaries

- V2 is a new application and database. Do not mount, migrate, or restore V1
  PostgreSQL data into V2. Never point a V2 connection string at the `monikey`
  database or namespace.
- V1's Git-declared resources live in namespace `monikey`. Its PostgreSQL
  StatefulSet `postgres` has a `volumeClaimTemplates` entry named `data`, which
  produces claim `data-postgres-0` requested at 10Gi; the separate receipt
  PVC is `monikey-receipts`. Preserve both claims and all V1 manifests
  throughout V2 launch, trial use, and rollback. These names and requested
  size come from the audited Git revision, not live PVC/PV inspection. Record
  actual claim UIDs, PV names, reclaim policies, capacity, and Argo ownership
  immediately before change. Do not delete the V1 Argo Application, namespace,
  PVCs, or finalizers as part of this procedure.
- V2 is planned in namespace `monikey-v2`, with StatefulSet
  `monikey-v2-postgres`, database/user `monikey_v2`, and claim
  `monikey-v2-postgres-data`. Its `postgres` Service is namespace-scoped and
  does not identify or share V1 storage. Verify V2's bound PVC identity before
  writes; never copy V1 claim names or bind V2 to a V1 PV.
- The GitOps App-of-Apps enables automated sync, prune, and self-heal. A future
  GitOps diff must be reviewed for removed resources and claim identity before
  merge. A namespace move or rename is not a safe way to preserve V1.
- The audited platform is a single K3s VM on a single Proxmox node. Longhorn's
  one replica is not an independent failure-domain backup. A Proxmox/VM
  recovery point and a separate validated PostgreSQL archive are required.
- Application image rollback does not roll back a PostgreSQL schema. Migration
  compatibility and a tested restore path are required before enabling traffic.
- No cutover command may be run without explicit owner approval. This is a
  checklist and evidence form, not deployment authorization.

## Required evidence before scheduling cutover

The source-only V1 inventory and its Git-declared PVC requests are recorded in
`docs/architecture/HOMELAB_GITOPS_AUDIT.md` at the audited commit. That inventory
is not live evidence. Complete the following capture against the actual cluster
before approving any PR that changes application ownership or hostname routing.

Record each value in the release evidence outside this repository; do not
write credentials, private keys, database rows, or financial values here.

- [ ] Owner approval for the change window, hostname, private CA/device trust,
      and same-host backup risk.
- [ ] Live Argo application, repo revision, sync/prune/self-heal state and
      resource ownership inspected by an authorized operator.
- [ ] Live V1 namespace, StatefulSet, generated database PVC, receipts PVC,
      PVs, reclaim policies, and Argo tracking identities recorded; live V2
      namespace and distinct database/backup claim bindings recorded. The V1
      Git-declared `data-postgres-0` and `monikey-receipts` names alone are not
      sufficient evidence.
- [ ] Reviewed GitOps PR pins the exact six V2 image digests (web, API,
      migration, PostgreSQL, backup, backup-metrics) and includes the
      ingress/TLS and encrypted-secret bootstrap work. Its diff proves no V1
      Application, namespace, StatefulSet, or PVC is removed or renamed.
- [ ] The release renderer produced a candidate from the retained manifest; all six images are digest-pinned and the root schema-validates. Review the candidate and keep the cutover Ingress a separate reviewed change.
- [ ] New V2 database and backup PVCs have measured sizes, expected Longhorn
      storage class, and confirmed bound claim identities. Never infer these from
      V1 claims or the requested capacity of existing platform claims.
- [ ] Secret recovery material is available through the approved SOPS/age
      procedure, and a recovery operator has rehearsed decryption/bootstrap
      without placing plaintext in Git, shell history, logs, or this vault.
- [ ] Migration image digest and exact schema version are recorded. Migration
      was run against a disposable production-like copy; old/new application
      compatibility and failure behavior are documented.
- [ ] The reviewed sync completed the wave 1 pre-migration backup hook before
      the wave 2 migration hook. Retain its successful archive identity,
      checksum, and `pg_restore --list` validation with the release evidence.
- [ ] Latest V2 custom-format dump passes checksum and `pg_restore --list`;
      restore into a new isolated database passes row-count-free finance
      invariants, balanced journals, transaction revisions, and login/report/export
      smoke checks. Record the recovery point and restore duration.
- [ ] Independent Proxmox/K3s VM recovery point is complete and its restore
      procedure is known. A Longhorn replica on this single node does not satisfy
      this requirement.
- [ ] Prometheus scrape, alert delivery path, backup metric, disk/PVC
      headroom, and logs have been checked. Alertmanager is disabled in the
      audited GitOps snapshot; delivery must be explicitly established.
- [ ] At least one owner-controlled device trusts the selected private CA and
      confirms HTTPS/PWA login, session security, API, and finance flows.
- [ ] Change operator, observer, success criteria, stop conditions, and
      rollback decision deadline are recorded.

If any item is not met, do not switch the hostname.

## Pre-change capture

1. Freeze V2 writes during the final backup window. Record current desired
   GitOps commit and live Argo/resource state, including the V1 Application,
   namespace, PostgreSQL StatefulSet, V1 data PVC, and receipts PVC identities.
2. Capture the approved Proxmox/K3s VM recovery point using the owner's
   established platform procedure. Verify its completion and retention.
3. Create a V2 custom-format PostgreSQL archive on the dedicated backup PVC.
   Verify checksum, `pg_restore --list`, timestamp, and size. Run a final
   isolated restore drill if the planned release differs from the last
   restore-tested release.
4. Export the current V2 GitOps commit, all six image digests (web, API,
   migration, PostgreSQL, backup, and backup-metrics), migration/schema
   version, backup identity, and smoke-test evidence to the release record.
5. Verify the reviewed GitOps diff contains V2 resources only and has no
   destructive V1 changes. Do not disable prune globally without an explicit
   design review; instead ensure the PR does not remove V1-owned resources.

## Controlled V2 activation

1. Merge only the approved PR, then observe Argo sync in waves: PostgreSQL,
   pre-migration backup hook, migration hook, API, web, backup metrics, and
   separately reviewed ingress. Stop if either hook fails, any V1 resource
   changes, or the observed live object identity differs from the reviewed
   diff.
2. Confirm the actual V2 StatefulSet is bound to the new V2 PVC and the API
   connects only to the V2 database/service. Confirm V1 database and PVCs
   remain present and unchanged.
3. Validate the certificate chain and hostname from the actual owner devices;
   confirm no insecure HTTP/session-cookie fallback. Exercise health, login,
   account totals, a disposable transaction if production data has not begun,
   reports, exports, backup, and restore evidence.
4. Switch local DNS/Traefik host routing only through the reviewed GitOps
   change. Keep the V1 service and its PVCs intact. Record timestamps, Argo
   health, alert status, and operator decisions.
5. Monitor through the agreed observation period. Stop writes and invoke
   rollback if data integrity, authentication, restoreability, monitoring, or
   availability criteria fail.

## Rollback decision and procedure

Rollback triggers include unbalanced or missing ledger data, failed or
unverifiable backup, unexpected migration/schema state, authentication/session
failure, certificate trust failure, sustained outage, V1 resource mutation, or
owner decision within the change window.

1. Announce rollback and freeze V2 writes. Record the last accepted V2 write
   time and the current Argo/GitOps revision.
2. Revert the V2 hostname/ingress routing to the pre-change path through a
   reviewed GitOps change. Do not delete V2 resources, PVCs, or archives.
3. Keep V1 untouched. Confirm its original namespace, workload, claim identities,
   and health before routing users back. If V1 requires recovery, use only the
   separately approved V1 recovery procedure and V1 backup; never use V2 dumps.
4. If V2 data must be recovered, restore its verified archive into a newly
   created isolated V2 database/PVC. Validate the schema and finance invariants
   before any routing change. Do not restore over either running database.
5. If schema incompatibility prevents the previous V2 image from starting,
   preserve the upgraded V2 database and restore the pre-change V2 archive to a
   separate new database/PVC, then test the compatible image against it. Never
   assume an image rollback reverses a migration.
6. Confirm HTTPS routing, API readiness, login, ledger totals, backup
   verifiability, monitoring, and all V1 resource identities. Leave V2 stopped
   or isolated until the owner accepts a new recovery plan.
7. Attach sanitized timeline, exact commits/digests, schema versions, recovery
   point, validation results, and follow-up tasks to the incident record.

## Post-cutover retention (P6-11)

V1 remains intact after successful V2 activation. Do not remove it on a timer
or as part of rollback cleanup. Any later V1 retirement requires a separate
owner-approved decision, a verified V1 backup and restore, confirmation that
V2 is the accepted daily-use system, and a reviewed GitOps PR whose PVC deletion
and reclaim consequences are explicitly understood.

## Current state

At authoring time, only repository source at the audited commit was inspected;
there was no kubeconfig or live Argo/cluster evidence. The runbook's checkboxes
are therefore open. No production command, secret creation, GitOps edit,
cutover, or V1 resource change has been performed.
