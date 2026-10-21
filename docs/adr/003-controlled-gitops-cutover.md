# ADR-003: Controlled GitOps production cutover

- Status: Accepted by approved product plan
- Date: 2026-10-22
- Owners: MoniKey project owner
- Related plan items: Sections 9–12, P6-01–P6-11

## Context

Production uses an existing k3s and Argo CD homelab. Replacing V1 without inspected manifests, tested migrations, backups, and a rollback plan could remove persistent data or expose secrets.

## Decision

Production runs only through manually reviewed GitOps promotion using approved image digests. Inspect live cluster and repository state before authoring deployment changes. Keep V1 PVCs and manifests through cutover; do not migrate V1 data or prune old resources as part of deployment.

## Consequences

Production deployment is not part of routine implementation. TLS, secret bootstrap, migrations, backups, restore, monitoring, cutover, and rollback each require evidence and owner acceptance before release.

## Alternatives considered

Direct cluster edits, guessed manifest paths, reusing the V1 database, and automatic destructive pruning were rejected.
