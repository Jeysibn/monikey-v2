# Phase 6 readiness and deployment boundary

Updated: 2026-10-22

Phase 6 is a controlled homelab replacement, not a local application task. This note records the read-only audit so deployment work does not begin from guessed paths or stale V1 assumptions.

## Evidence inspected

- The Obsidian Homelab GitOps project documents a single-node K3s platform on Proxmox, Argo CD App-of-Apps, Calico, MetalLB, Traefik, Pi-hole, Unbound, Longhorn, Prometheus, Loki, Grafana, and Alloy.
- The same project documents the intended source repository as `/home/jeysi/homelab-gitops`, but that path is absent in the current filesystem. No authoritative manifests, Helm values, Terraform files, Argo Applications, issuer configuration, or secret-management files were available to inspect.
- `kubectl`, `argocd`, `helm`, and `kustomize` are not installed in this environment, so no live cluster or Argo state was inspected.
- The Homelab `Three-Tier Application` note describes an older Node worker, Nginx frontend, receipt PVC, and plain out-of-band Secret design. MoniKey V2 explicitly excludes a worker, receipt storage, and guessed production reuse. That note is reference evidence only and must not be copied into V2 deployment manifests.

## Local recovery evidence

- `docs/runbooks/restore.md` now documents custom-format PostgreSQL backup validation and isolated restore commands.
- A disposable Docker Compose restore drill succeeded on 2026-10-22. The archive passed `pg_restore --list`, restored into a new database with `--exit-on-error`, returned expected user/journal/revision counts, and the isolated database was removed. This is local readiness evidence only; it does not satisfy the production CronJob, retention, monitoring, or owner-approval gates below.

## Required before authoring Phase 6 manifests

1. Make the authoritative `/home/jeysi/homelab-gitops` checkout available, or provide its approved replacement path and branch.
2. Inspect the live Argo applications, ingress/cert-manager issuer, Longhorn class/PVC conventions, Tailscale/Pi-hole DNS path, resource capacity, NetworkPolicies, monitoring labels, and backup jobs.
3. Confirm the owner-approved hostname, image registry/digest workflow, SOPS/age or other secret bootstrap path, and whether a new V2 PostgreSQL PVC is authorized.
4. Complete the Phase 5 owner/WCAG/physical-device gates and obtain explicit approval for any GitOps PR, secret creation, cluster change, cutover, or V1 resource retention/removal action.

## Safety decision

No Kubernetes manifests, GitOps changes, secrets, image publication, cluster commands, cutover, or V1 resource changes were made. The local Docker stack remains the only running deployment. Phase 6 stays pending until authoritative infrastructure evidence and owner approval are available.
