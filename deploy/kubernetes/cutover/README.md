# Hostname cutover resources

This directory is intentionally excluded from `deploy/kubernetes/kustomization.yaml`.
V1 currently owns `monikey.homelab.local`; syncing this Ingress alongside V1
could create competing Traefik routes. Include it in a reviewed GitOps
cutover-only change after the V1 backup, preservation, TLS trust, V2 smoke, and
owner approval gates in `docs/runbooks/phase6-cutover-and-rollback.md` pass.

The Ingress references the V2 web Service and cert-manager-managed
`monikey-v2-web-tls` Secret. Before enabling it, verify the CA is installed on
each owner device and the existing Traefik HTTP-to-HTTPS redirect applies.
Do not add V1 ingress deletion to the same change unless the owner explicitly
approves a separate rollback-reviewed resource change.
