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

The production CronJob, retention path, credentials, monitoring, and restore target require the authoritative homelab GitOps checkout and owner approval. Until those are available, this runbook is local evidence only; no Kubernetes backup job, secret, PVC, V1 resource, or cutover state may be guessed or changed.

## Local drill evidence

On 2026-10-22, a disposable Compose custom-format archive was created, validated with `pg_restore --list`, restored into an isolated `monikey_restore_check` database with `--exit-on-error`, and queried successfully (`2` users, `20` journals, `18` transaction revisions). The isolated database was dropped afterward. The archive was kept only in `/tmp` for the drill and is not repository data.
