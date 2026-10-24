# Kubernetes network policy package

Updated: 2026-10-23

## Scope

`deploy/kubernetes/network/` contains default-deny ingress/egress and explicit
MoniKey V2 traffic allowances. The package is source-only; it was rendered and
schema-validated locally and has not been applied to a cluster.

The policies assume namespace `monikey-v2` and the listed workload labels. The
read-only GitOps checkout at `2369afce6161f8c3f3f970cf1e484e44b3227df9`
currently places V1 in namespace `monikey`, Traefik in `traefik-system`,
Prometheus in `monitoring`, and documents Calico. `monikey-v2` is deliberately
separate for parallel V1 preservation, but live cluster namespace state and
owner approval are still required before promotion.

## Allowed paths

| Source                     | Destination                   | Port       | Purpose                                                 |
| -------------------------- | ----------------------------- | ---------- | ------------------------------------------------------- |
| `traefik-system` namespace | V2 web pods                   | TCP 8080   | Browser ingress through the existing Traefik controller |
| V2 web pods                | V2 API pods                   | TCP 3000   | Same-origin API proxy                                   |
| `monitoring` namespace     | V2 API pods                   | TCP 3000   | Prometheus scrape of the API metrics endpoint           |
| `monitoring` namespace     | V2 backup-metrics pod         | TCP 9100   | Prometheus scrape of validated backup-volume metrics    |
| V2 API pods                | V2 PostgreSQL pods            | TCP 5432   | Financial API database access                           |
| V2 migration job           | V2 PostgreSQL pods            | TCP 5432   | Explicit pre-deploy migration                           |
| V2 backup job              | V2 PostgreSQL pods            | TCP 5432   | Scheduled custom-format dump                            |
| V2 pods                    | CoreDNS pods in `kube-system` | UDP/TCP 53 | Service discovery                                       |

All other pod ingress and egress in the namespace is denied. NetworkPolicy
rules are additive: workloads must use the package's exact
`app.kubernetes.io/name` labels for the paths above to work. The migration Job and backup-metrics Deployment now carry the labels referenced by these policies.
The Traefik allowance is limited to the `traefik-system` namespace and web
port; the Prometheus allowance is currently namespace-scoped to `monitoring`
because the audited repository does not record the Prometheus server pod
selector. Narrow it to the verified server labels before promotion.

## Validation and promotion gates

- Kustomize v5.7.1 rendered eight NetworkPolicy resources.
- kubeconform v0.6.7 validated all seven against Kubernetes v1.30 schemas.
- Prettier and `git diff --check` passed.
- No cluster policy-engine behavior or DNS/namespace labels were tested live.
- Before promotion, verify the namespace choice, CoreDNS labels, Calico policy
  enforcement, Prometheus source labels, and actual workload labels. Run an
  in-cluster connection matrix after the API/web/database/migration workloads
  exist. Do not add broader egress to make a failing path pass without
  identifying the required destination.

See `docs/release/PHASE6_READINESS.md` and `docs/architecture/HOMELAB_GITOPS_AUDIT.md`.
