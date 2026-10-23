# Homelab GitOps read-only audit

Updated: 2026-10-23

This is a read-only audit of the public `Jeysibn/homelab-gitops` repository.
It does not authorize a GitOps change, secret creation, image publication,
cluster command, cutover, or V1 resource removal. Repository facts below are
from the audited commit; they are not evidence of current live cluster state.

## Source and evidence

- Repository: `https://github.com/Jeysibn/homelab-gitops`
- Default branch: `main`
- Audited commit: `2369afce6161f8c3f3f970cf1e484e44b3227df9`
- Visibility: public
- Branch protection: enabled on `main`
- The read-only checkout at `/home/jeysi/homelab-gitops` is present, clean,
  and on `main` at the audited SHA. `git ls-remote origin refs/heads/main`
  matched that SHA on 2026-10-23.
- Current-session tool check: `kubectl`, `argocd`, and `helm` are unavailable,
  and no kubeconfig exists. Temporary Kustomize v5.7.1 and kubeconform v0.6.7
  binaries are available and validated the current V2 templates separately;
  local schema checks do not establish live cluster state.
  SOPS/age availability must be checked again before secret-path work.

## Platform facts verified in Git

- Single-node K3s with Calico, Argo CD App-of-Apps, Traefik, MetalLB,
  Longhorn, Pi-hole/Unbound, Prometheus, Loki, Grafana, and Alloy.
- Argo registry tracks `main`, enables automated sync, prune, self-heal, and
  namespace creation, and uses explicit sync waves.
- Traefik redirects HTTP to HTTPS and exposes `192.168.86.200`; the repository
  defines a self-signed cert-manager ClusterIssuer named `homelab-selfsigned`.
- Longhorn is the default storage class with one replica for the single-node
  topology. The MoniKey PostgreSQL StatefulSet requests a 10Gi Longhorn PVC.
- Prometheus retains seven days with a 5Gi Longhorn volume; Loki retains 168
  hours with a 10Gi volume; Grafana uses a 5Gi Longhorn volume. Prometheus
  Alertmanager is disabled in the checked commit.
- The Argo registry uses pinned chart versions for platform services, but the
  application manifests use mutable image tags.

## MoniKey manifest findings

The current `kubernetes/manifests/monikey` directory is not a V2 deployment
baseline and must not be copied into this repository:

- `worker.yaml` deploys a background worker. V2 explicitly excludes a worker
  and recurring auto-posting.
- `receipts-pvc.yaml`, `/data` mounts, and receipt storage are present. V2
  explicitly excludes receipt storage.
- `api.yaml`, `web.yaml`, and `migrate-job.yaml` use
  `ghcr.io/jeysibn/monikey-*:latest`; this does not satisfy V2 immutable digest
  publication and promotion.
- `configmap.yaml` sets `NODE_ENV=development`, `APP_ORIGIN=http://...`, and
  `SESSION_SECURE=false`. This is not acceptable for V2 production private
  authentication or PWA HTTPS requirements.
- The application ingress has a host rule but no TLS block. The self-signed
  ClusterIssuer is not wired to that ingress in the audited manifest.
- The configuration contains V1-style integration/provider settings for OCR,
  email, banking, FX, crypto quotes, and AI. V2 excludes these integrations.
- `monikey-secrets` is created manually with `kubectl create secret`; no
  SOPS/age or equivalent GitOps secret bootstrap is configured in the audited
  path.
- No MoniKey NetworkPolicy, backup CronJob, isolated restore Job, or
  application-specific Prometheus alert rules are present in the audited
  manifest set.
- The V1 migration Job is a useful ordering reference, but its mutable image
  and V1 configuration cannot be reused without a V2-specific design review.
  V2 now defines its own PostgreSQL wave 0, backup wave 1, migration wave 2,
  API/web waves 3/4, and separately reviewed ingress wave 6.

## V1/V2 resource ownership boundary

At audited GitOps commit `2369afce6161f8c3f3f970cf1e484e44b3227df9`, the
explicit Argo Application is named `monikey`, tracks this repository's `main`
at `kubernetes/manifests/monikey`, targets namespace `monikey`, and enables
automated sync, prune, and self-heal. The V1 templates declare PostgreSQL
StatefulSet `postgres` with a `volumeClaimTemplates` entry named `data`; its
derived claim is `data-postgres-0` in namespace `monikey`. V1 also declares the
`monikey-receipts` claim in that namespace. These are Git-declared identities;
actual bound PVC UIDs, PVs, reclaim policies, and live Argo ownership still
require cluster inspection.

### Audited V1 Git-declared inventory

The following inventory is from the read-only checkout at
`2369afce6161f8c3f3f970cf1e484e44b3227df9`. It enumerates desired objects in
the V1 Argo path; it is not a live-cluster snapshot.

| Sync wave | Source file         | Git-declared objects                                                               | Preservation note                                                                                                                                                              |
| --------- | ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0         | `configmap.yaml`    | `ConfigMap/monikey-config`                                                         | V1 app settings; do not move into V2.                                                                                                                                          |
| 0         | `receipts-pvc.yaml` | `PersistentVolumeClaim/monikey-receipts`, `longhorn`, `ReadWriteOnce`, 5Gi request | Preserve claim; actual UID/PV/reclaim policy/capacity require live capture.                                                                                                    |
| 0         | `postgres.yaml`     | `Service/postgres`, `StatefulSet/postgres`                                         | One replica; `volumeClaimTemplates[data]` requests `data-postgres-0` in namespace `monikey`, `longhorn`, `ReadWriteOnce`, 10Gi. Preserve StatefulSet and generated data claim. |
| 1         | `migrate-job.yaml`  | `Job/monikey-migrate`                                                              | V1 migration object; never reuse for V2.                                                                                                                                       |
| 2         | `api.yaml`          | `Service/api`, `Deployment/api`                                                    | V1 workload; keep its namespace and ownership separate.                                                                                                                        |
| 2         | `worker.yaml`       | `Deployment/worker`                                                                | V1-only worker; V2 does not adopt it.                                                                                                                                          |
| 2         | `web.yaml`          | `Service/web`, `Deployment/web`                                                    | V1 workload; keep its namespace and ownership separate.                                                                                                                        |
| 3         | `ingress.yaml`      | `Ingress/monikey`                                                                  | V1 currently owns `monikey.homelab.local`; keep V2 ingress in a separately reviewed cutover change.                                                                            |

This is 11 Git-declared Kubernetes objects. `monikey-secrets` is referenced by
V1 manifests but is manually created outside this repository, so its live
existence, keys, ownership, and recovery state must be captured by an
authorized operator without recording secret values. The Argo Application is
`monikey`, reads this path from `main`, targets namespace `monikey`, and has
automated prune/self-heal plus a resources finalizer. Removing V1 files or
deleting the Application can therefore have destructive consequences; review
the rendered diff and actual tracking identities before any cutover PR.

The V2 templates currently target a separate `monikey-v2` namespace. They
declare StatefulSet `monikey-v2-postgres`, database/user `monikey_v2`, and a
separately named database claim `monikey-v2-postgres-data`; the Service name
`postgres` is namespace-local and does not collide with V1's `monikey/postgres`.
V2 also has a separately named backup claim. Preserve this namespace boundary
and verify actual V2 claim binding before any rollout. Do not move V2 resources
into `monikey`, reuse `data-postgres-0`, or treat a Git-declared name as proof
of live storage identity.

Because the existing V1 Argo Application prunes resources removed from its
path, the reviewed GitOps promotion must leave the V1 path/Application intact
and add V2 as separately owned resources. Inspect the rendered diff and live
Argo tracking before merge; a future V2 Application must have a distinct name,
path and destination namespace. No Argo Application ownership or live pruning
behavior has been changed or verified in-cluster.

## Live preflight evidence checklist

V2-specific templates now exist in this application repository. The remaining
P6-01 work is to verify that their assumptions match current GitOps and live
platform state. Record command output or UI evidence, observation time, and
the source (Git commit or live cluster) for every item; do not infer live state
from repository YAML.

| Area                     | Evidence to collect before promotion                                                                                      | V2 assumption to compare                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Argo CD                  | Application source/revision, destination namespace, sync policy, health/sync status, resource tracking and prune behavior | V2 application is isolated; no V1 resource is adopted or pruned                                                |
| Kubernetes               | Server version, node capacity/taints, namespace labels, admission policies, service accounts and security defaults        | Restricted non-root pods and CronJob `timeZone` are supported                                                  |
| Ingress and certificates | Traefik entrypoints/middleware, cert-manager version, live ClusterIssuer readiness, Certificate events and served chain   | `homelab-selfsigned` is usable and the V2 CA/leaf chain can serve the approved hostname                        |
| Storage                  | StorageClass parameters, Longhorn replica/backup state, available capacity, reclaim policy and snapshot behavior          | New V2 database and backup PVCs fit available capacity and have understood single-node failure risk            |
| DNS and device path      | Pi-hole/Unbound record, client route, intended owner devices, HTTPS certificate and PWA install/login                     | `monikey.homelab.local` resolves only as intended and is trusted on actual devices                             |
| Network policies         | Calico version/state, namespace and pod labels, policy logs or connectivity probes for each required path                 | Default-deny permits only the documented ingress, API, DB, DNS, scrape, migration and backup flows             |
| Secrets                  | Argo config/plugin/decryption path, age recipient custody, recovery procedure, Secret ownership and rotation path         | Ciphertext is decrypted only in the approved cluster path; no plaintext is committed or logged                 |
| Monitoring               | Prometheus scrape target/labels, rules loaded, Alertmanager routing, backup exporter data, Loki ingestion/redaction       | Health, database, storage, migration, TLS and backup failures are visible and delivered                        |
| Backups                  | PVC capacity and mount, scheduled Job result, archive listing, isolated restore result and retention                      | A V2-only archive restores to a separate database; backup and database single-node failure domain is accepted  |
| V1 boundary              | Current V1 Argo resources, PVC identifiers, service/ingress ownership, baseline data and rollback target                  | V1 manifests/PVC remain preserved and outside V2 prune/ownership until a separate approved retirement decision |

Re-fetch the remote repository and verify the audited SHA before using its
paths as current. No PR, secret creation, image publication, cluster command,
cutover, or V1 resource change is authorized by this inventory. Until live
evidence and applicable owner approvals are recorded, local Compose remains
the only verified deployment target.
