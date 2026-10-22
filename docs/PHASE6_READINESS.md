# Phase 6 readiness and deployment boundary

Updated: 2026-10-23

Phase 6 is a controlled homelab replacement, not a local application task. This note records the read-only audit so deployment work does not begin from guessed paths or stale V1 assumptions.

## Evidence inspected

- The documented local checkout `/home/jeysi/homelab-gitops` is absent, but the public remote `Jeysibn/homelab-gitops` was inspected read-only through GitHub at commit `2369afce6161f8c3f3f970cf1e484e44b3227df9`. The repository is public, its `main` branch is protected, and its GitOps workflow is visible.
- The remote repository confirms a single-node K3s platform on Proxmox, Argo CD App-of-Apps, Calico, MetalLB, Traefik, Pi-hole, Unbound, Longhorn, Prometheus, Loki, Grafana, and Alloy. Its registry tracks `main`, uses pinned platform chart versions, and enables automated sync, prune, and self-heal.
- The remote MoniKey manifests are a legacy deployment reference, not a V2 baseline: they include a worker and receipt PVC, use mutable `:latest` images, set `NODE_ENV=development`, use `http://monikey.homelab.local` with `SESSION_SECURE=false`, omit ingress TLS wiring, create a plain out-of-band Secret, and have no V2 backup CronJob, NetworkPolicy, or application alert path. See `docs/architecture/HOMELAB_GITOPS_AUDIT.md` for the complete finding list.
- `kubectl`, `argocd`, `helm`, and `kustomize` are not installed in this environment, so no live cluster or Argo state was inspected. Git state must not be treated as live state.

## Local recovery evidence

- `docs/runbooks/restore.md` now documents custom-format PostgreSQL backup validation and isolated restore commands.
- A disposable Docker Compose restore drill succeeded on 2026-10-22. The archive passed `pg_restore --list`, restored into a new database with `--exit-on-error`, returned expected user/journal/revision counts, and the isolated database was removed. This is local readiness evidence only; it does not satisfy the production CronJob, retention, monitoring, or owner-approval gates below.
- Production Docker build targets now exist for the API, web, and one-shot migration service. On 2026-10-23 all three built locally; the migration image applied five migrations to a disposable fresh PostgreSQL database, the API image returned ready with DB connected, and the nonroot web image served CSP/security headers and proxied the real API. See `docs/runbooks/production-images.md`. These are local image tests only; no registry publication, deployment, or live-cluster validation occurred.
- Final local API, web, and migration image IDs have zero Trivy HIGH/CRITICAL findings and each has a local SPDX SBOM. Registry digest scans, provenance retention, and release policy remain open.

## Required before authoring Phase 6 manifests

1. Make the authoritative `/home/jeysi/homelab-gitops` checkout available, or explicitly approve the audited remote commit/path as the source for a future GitOps PR.
2. Inspect the live Argo applications, ingress/cert-manager issuer, Longhorn class/PVC conventions, Tailscale/Pi-hole DNS path, resource capacity, NetworkPolicies, monitoring labels, and backup jobs.
3. Confirm the owner-approved hostname, image registry/digest workflow, SOPS/age or other secret bootstrap path, and whether a new V2 PostgreSQL PVC is authorized.
4. Complete the Phase 5 owner/WCAG/physical-device gates and obtain explicit approval for any GitOps PR, secret creation, cluster change, cutover, or V1 resource retention/removal action.

## Safety decision

No Kubernetes manifests, GitOps changes, secrets, image publication, cluster commands, cutover, or V1 resource changes were made. The remote audit reduces the P6-01 source-repository uncertainty, but live validation and every deployment gate remain pending. The local Docker stack remains the only running deployment.
