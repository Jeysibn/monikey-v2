# Homelab GitOps read-only audit

Updated: 2026-10-22

This is a read-only audit of the public `Jeysibn/homelab-gitops` repository. It
does not authorize a GitOps change, secret creation, image publication,
cluster command, cutover, or V1 resource removal.

## Source and evidence

- Repository: `https://github.com/Jeysibn/homelab-gitops`
- Default branch: `main`
- Audited commit: `2369afce6161f8c3f3f970cf1e484e44b3227df9`
- Visibility: public
- Branch protection: enabled on `main`
- Read-only inspection used the GitHub CLI because the documented local
  checkout `/home/jeysi/homelab-gitops` is not present in this environment.
- `kubectl`, `argocd`, `helm`, and `kustomize` are unavailable locally, so this
  document does not claim that the live cluster matches Git.

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
- The migration Job is a useful ordering reference (wave 1 after PostgreSQL,
  before API/web), but its mutable image and V1 configuration cannot be reused
  without a V2-specific design review.

## V2 deployment implications

The remote repository is now sufficient to inform a future V2 deployment
design, but not to authorize one. Before any Phase 6 implementation:

1. Confirm the owner-approved V2 hostname, private CA trust path, and image
   registry/digest workflow.
2. Design new V2 API/web/PostgreSQL manifests from the V2 Compose topology;
   do not reuse worker, receipt, provider, or V1 database resources.
3. Define the approved SOPS/age or equivalent secret bootstrap and recovery
   path before writing manifests.
4. Add a dedicated V2 migration image/Job, NetworkPolicies, resource budgets,
   backup/restore CronJob, monitoring labels, and alert rules.
5. Inspect live Argo, Traefik/cert-manager, Longhorn, DNS, and monitoring state
   with the owner-approved tools before a GitOps PR or cutover.

Until those gates are approved and verified, the local Docker Compose stack is
the only deployment target and all V1 homelab resources remain untouched.
