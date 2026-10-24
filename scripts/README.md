# Repository scripts

Run supported commands through `npm run` from the repository root. npm aliases
remain stable even when implementation files move. Tests stay beside the scripts
they exercise; runtime imports use relative paths and filesystem operations that
need repository files resolve the repository root explicitly.

| Folder      | Responsibility                                          | npm entry points                                                             |
| ----------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `checks/`   | CI workflow, OpenAPI parity, Kubernetes schemas         | `check:ci-workflow`, `contracts:check`, `deploy:check`                       |
| `database/` | Schema version, migration checks, backup and restore    | `test:migration-upgrade`, `backup:local`, `restore:local`                    |
| `release/`  | Main-merge verification and immutable release manifests | `test:release-verifier`, `test:release-manifest`, `render:release-manifests` |
| `security/` | Secret scanning and encrypted secret bootstrap          | `security:secrets`, `test:secrets-bootstrap`                                 |
| `testing/`  | PostgreSQL suite orchestration and route review         | `test:integration`, `review:local`                                           |
| `assets/`   | PWA icon generation                                     | `pwa:icons`                                                                  |

See the [testing guide](../docs/development/TESTING.md) for the disposable
PostgreSQL/API/browser setup and [runbooks](../docs/runbooks/) for operational
procedures. `.github/workflows/ci.yml` invokes the release scripts explicitly;
update those paths together with npm commands and tests if scripts move again.
No script organization change grants deployment or V1-resource approval.
