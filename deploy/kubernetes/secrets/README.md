# Encrypted V2 runtime secret bootstrap

The live Argo CD repo-server has not been verified to include a SOPS decryption
plugin, and no age recipient has been approved for this application. Therefore
this directory is deliberately not included in the root Kustomization yet.
Do not point Argo at an encrypted file as if it were a Kubernetes Secret.

The generator `scripts/create-gitops-secrets.mjs` creates a random PostgreSQL
password and builds the V2 runtime and backup-client Secret documents in a
mode-0600 temporary file inside a mode-0700 system temporary directory for
SOPS. It removes that directory on success or failure and writes only the
encrypted result to `runtime.enc.yaml` with mode `0600` in the project tree.
Plaintext is never written to the worktree or printed. SOPS stderr is suppressed on failure; the generator reports only the exit status so subprocess diagnostics cannot echo input. Process-level tests cover cleanup on both success and failure. Run it only after:

1. An authorized operator has verified the Argo SOPS plugin/decryption
   configuration and its exact supported SOPS version.
2. The owner has provisioned the age key securely, backed up its private key
   outside Git/Obsidian, and supplied its public `age1...` recipient through
   `SOPS_AGE_RECIPIENTS`.
3. The V2 namespace, database/service name, and desired secret key contracts
   have been reviewed against the live deployment plan.

Example (recipient is public key material; never pass a private key):

```sh
SOPS_AGE_RECIPIENTS='age1REPLACE_WITH_OWNER_APPROVED_PUBLIC_RECIPIENT' \
  node scripts/create-gitops-secrets.mjs
```

The encrypted output is not safe to commit until an owner-approved recipient
is used and decryption has been tested through the actual Argo path. Keep the
private age key in the authorized cluster/recovery secret store only; never
commit it, add it to an image, or save it in the Obsidian vault. If a key is
rotated, re-encrypt the file for the new recipient and rehearse recovery before
removing the old recipient.
