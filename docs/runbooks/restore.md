# PostgreSQL backup and isolated restore runbook

This runbook applies to MoniKey V2 PostgreSQL only. It is a prerequisite for entering real financial data. It does not migrate or restore V1 data.

## Backup policy

- Use PostgreSQL custom-format dumps (`pg_dump --format=custom`) so completeness can be inspected with `pg_restore --list` and the archive can be restored into a new database.
- Keep the live database and backup directory separate but on the same approved host, matching the owner-accepted same-host failure-domain risk in the master plan.
- Retain at least seven daily and four weekly known-good archives when production storage capacity is confirmed. Rotation must never remove the newest known-good archive solely because a newer dump failed.
- Restrict the backup directory to the database/backup operator. Do not place dumps in Git, the web root, container layers, screenshots, or Obsidian notes.
- Log only backup status, archive size, timestamp, and validation result. Do not log rows, credentials, or financial values.

## Local Docker backup

The following commands target the disposable Compose database. Set `BACKUP_FILE` to a protected local path before using them outside a disposable environment.

```sh
BACKUP_FILE=/secure/local/path/monikey-$(date +%Y%m%d-%H%M%S).dump
docker compose exec -T db pg_dump \
  -U monikey -d monikey --format=custom > "$BACKUP_FILE"
docker compose exec -T db pg_restore --list < "$BACKUP_FILE" | sed -n '1,12p'
```

The dump command must exit successfully and the archive listing must contain the expected schema/data table-of-contents entries. A failed dump is not a backup and must not trigger rotation of the last known-good archive.

The repository also provides local-only aliases that enforce the same safety
checks without placing an archive in the worktree:

```sh
BACKUP_FILE=/secure/local/path/monikey-$(date +%Y%m%d-%H%M%S).dump \
  npm run backup:local
BACKUP_FILE=/secure/local/path/monikey-20261022-120000.dump \
RESTORE_DB=monikey_restore_check_local \
  npm run restore:local
```

`backup:local` refuses relative paths and paths that resolve inside the
repository, including symlinked parent paths. It validates the database name
before creating an archive, writes a new custom-format archive with restrictive
permissions, and validates its listing.
It defaults to the `monikey` database; set `BACKUP_DATABASE` when using a
separate disposable database. `restore:local` validates the archive, creates
the named isolated database, restores with `--exit-on-error`, verifies applied
Prisma migrations, balanced journal postings, current transaction revisions,
and a journal for every posted transaction, then removes the isolated database
in a cleanup step. It prints table row counts only, never rows or financial
values.

## Isolated restore drill

Always restore into a newly created isolated database first. Never use `--clean` against the running V2 database and never overwrite a V1 database or PVC.

```sh
RESTORE_DB=monikey_restore_check
docker compose exec -T db dropdb --if-exists -U monikey "$RESTORE_DB"
docker compose exec -T db createdb -U monikey "$RESTORE_DB"
docker compose exec -T db pg_restore \
  -U monikey -d "$RESTORE_DB" --no-owner --exit-on-error < "$BACKUP_FILE"
docker compose exec -T db psql -U monikey -d "$RESTORE_DB" -Atc \
  "SELECT (SELECT count(*) FROM users),
          (SELECT count(*) FROM journals),
          (SELECT count(*) FROM transaction_revisions);"
docker compose exec -T db dropdb -U monikey "$RESTORE_DB"
```

Record the archive name, `pg_restore --list` success, restore exit status, isolated validation result, and cleanup result in the release evidence. Validate schema version, owner/session authentication, account balances, transaction history, reports, and exports against the accepted backup point before considering a recovery successful. Record the recovery point and any missing transaction window; an application image rollback does not undo an incompatible schema migration.

## Production gate

The production backup command and CronJob template are now in `deploy/kubernetes/backup/` and `docs/runbooks/production-backups.md`. The CronJob still requires a measured dedicated backup PVC, the encrypted `monikey-v2-postgres-client` Secret, actual namespace/network policy, exporter integration, and live cluster validation. Until those are available, this runbook remains local evidence only; no Kubernetes job, secret, PVC, V1 resource, or cutover state has been applied or guessed.

## Local drill evidence

On 2026-10-22, a disposable Compose custom-format archive was created, validated with `pg_restore --list`, restored into an isolated `monikey_restore_check` database with `--exit-on-error`, and queried successfully (`2` users, `20` journals, `18` transaction revisions). The isolated database was dropped afterward. The archive was kept only in `/tmp` for the drill and is not repository data. The new aliases were rerun against the current Node 22.22 Compose stack: an 89,137-byte archive passed listing validation and isolated restore validation, then cleanup completed; the temporary archive was removed.

### Current disposable-stack recovery drill — 2026-10-23

A fresh tmpfs E2E stack was seeded with one test owner. Through the actual API, the drill created an opening-balance account and an expense. `backup:local` created and listed a 73,107-byte custom-format archive from `monikey_e2e`; `restore:local` restored it to an isolated database and validated one user, one account, two transactions, two journals, four postings, and two revisions. All restored journals balanced, current revisions were present, and every posted transaction had a journal. The restore database and `/tmp` archive were removed. The persistent development database was untouched.

The path guard was also exercised against an in-repository `..vault` path, an external symlink into the repository, and an invalid `BACKUP_DATABASE` name. All were rejected before an archive file was created. A final fresh-stack rerun with the hardened helper restored the same disposable fixture and passed all ledger/revision checks (73,107-byte archive); the restore database and archive were removed.

### Fresh full-stack backup/restore verification — 2026-10-23

- Built a fresh isolated E2E stack from the current worktree with tmpfs PostgreSQL, seeded three disposable test users, and passed the real-API/Playwright acceptance run (25 passed, 9 expected skips).
- `backup:local` created a custom-format archive from `monikey_e2e`; `pg_restore --list` accepted it. The archive was mode 0600, 91,767 bytes, SHA-256 `1367b1b77fb12905169c0225147f601b938ddcc809349902394fb53ea334317e`.
- `restore:local` restored into a separate database and verified applied migrations, balanced journals, current transaction revisions, and journals for posted transactions. Counts: 3 users, 6 accounts, 16 transactions, 22 journals, 45 postings, and 20 revisions. The restore database, tmpfs stack, and temporary archive were removed; the persistent development stack remained healthy.
- This is local isolated recovery evidence only. It does not verify the production PVC, CronJob, Secret, same-host failure domain, or an owner-approved production recovery point.

### Current-worktree backup/restore recheck — 2026-10-23

A fresh tmpfs E2E stack was seeded with one disposable owner, account, opening balance, and expense through the actual API. `backup:local` created a 73,118-byte custom-format archive and `pg_restore --list` accepted it. `restore:local` restored to a separate database and verified one user, one account, two transactions, two balanced journals, four postings, and two revisions. The isolated restore DB, E2E stack, archive, and temporary seed script were removed. The persistent development database was not used. This remains local recovery evidence; it does not verify the production PVC, CronJob, Secret, or a production recovery point.
