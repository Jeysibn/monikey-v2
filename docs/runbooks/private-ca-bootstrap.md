# Private CA and device trust bootstrap

Status: manifests and procedure drafted; not applied to a cluster. The TLS
issuer facts below come from homelab GitOps source commit
`2369afce6161f8c3f3f970cf1e484e44b3227df9`; live cert-manager state must be
checked by an authorized operator before use.

## Issuer and certificate chain

The audited GitOps source installs cert-manager and defines the
`homelab-selfsigned` ClusterIssuer. V2 uses that issuer once to create a
dedicated V2 root CA Secret inside namespace `monikey-v2`; a namespaced
`monikey-v2-private-ca` Issuer then signs the 90-day V2 web certificate. The
web certificate is renewed automatically before expiry. The root key remains
in the Kubernetes Secret and is never included in Git, an image, repository
documentation, or Obsidian.

`deploy/kubernetes/app/tls.yaml` contains the Certificate/Issuer resources.
They are part of the normal V2 app render. The hostname Ingress is separate at
`deploy/kubernetes/cutover/ingress.yaml` and excluded from the normal Kustomize
root because V1 already owns `monikey.homelab.local`. Adding that route requires
the cutover procedure and explicit owner approval.

## Bootstrap steps for an authorized operator

1. Confirm the live cert-manager version and that ClusterIssuer
   `homelab-selfsigned` is Ready. Confirm Traefik uses the audited `websecure`
   entry point and HTTP-to-HTTPS redirect; do not infer live state from Git.
2. Review/apply the V2 app manifests through the owner-approved GitOps PR.
   Wait until `Certificate/monikey-v2-private-root` and
   `Certificate/monikey-v2-web` are Ready and the V2 Issuer reports Ready.
   Stop if certificate readiness fails or the generated Secret is not in the
   V2 namespace.
3. Export only the root certificate (`ca.crt`) from Secret
   `monikey-v2-private-root` through an authorized, access-controlled
   workstation. Never export `tls.key`, the private root key, or the whole
   Secret. Verify the certificate fingerprint independently before sharing.
4. Transfer the public CA certificate through the owner’s trusted device
   administration path. Install it as a trusted root on each intended phone
   and desktop. Keep the fingerprint and device install record in the
   restricted operational record, not in this repo/vault.
5. Once the cutover-only Ingress is approved, verify name resolution for
   `monikey.homelab.local` on each owner device, inspect the presented chain,
   hostname, expiry, and trust status, then test HTTPS login and PWA install.
   Verify cookies remain Secure and no HTTP application route is exposed.

## Renewal and recovery

- The leaf certificate is short-lived (90 days) and renews 15 days before
  expiry. Alert on certificate expiry and test renewal before production use.
- The root CA is long-lived (10 years) with key rotation disabled for automatic
  renewal. Renewal preserves its key but changes the CA certificate and
  validity dates; redistribute and reinstall the renewed public CA certificate
  before relying on it. Plan and test CA rollover before the root expires.
- Back up the root CA Secret only through the approved encrypted recovery
  process with narrow access. The Secret contains a signing private key; never
  put it in a normal PostgreSQL backup, SOPS file committed without approval,
  Obsidian note, issue, or terminal transcript.
- If the root key is lost or compromised, issue a new root and leaf, distribute
  the new public root to devices, verify trust, and only then switch the
  cutover route. Keep the previous root trusted during a planned transition;
  revoke/remove it only after all devices and rollback paths have moved.

## Acceptance record

Before closing P6-02 record the live issuer/cert-manager versions, root and
leaf fingerprints (public values only), renewal test, device/OS trust results,
DNS results, HTTPS chain result, PWA login result, and owner approval. No such
live or device acceptance has been performed yet.
