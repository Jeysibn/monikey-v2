# Release flow

The V2 repository follows the approved `feature → dev → main` workflow.

1. Create a short-lived `feature/<scope>` or `fix/<scope>` branch from `dev`.
2. Open a pull request into `dev`. `validate` and `CodeQL` must pass; resolve all review conversations.
3. After an integrated milestone is accepted on `dev`, open a pull request from `dev` to `main` with evidence and release notes.
4. Merge only when the same required checks pass. The repo owner is the only current reviewer, so required approval count is zero; pull requests and status checks remain mandatory.
5. Production deployment is a separate reviewed GitOps change using approved image digests. Merging to `main` does not deploy production.

`main` is the default branch. Both `main` and `dev` require pull requests, current `validate` and `CodeQL` checks, resolved conversations, and prohibit force pushes and branch deletion. No workflow pushes images or changes the homelab GitOps repository.
