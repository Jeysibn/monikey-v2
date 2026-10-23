# MoniKey V2 Prometheus integration

This is an integration package for the existing homelab Prometheus. It does
not create a Prometheus instance, alter upstream GitOps, or assume live
cluster service names. Confirm scrape routing, namespace labels, exporters,
and alert delivery against the live cluster before promotion.

## API scrape contract

The API exposes `GET /metrics` in Prometheus text exposition format. Scraping the endpoint performs a lightweight `SELECT 1` and reports `monikey_database_connected`. The endpoint is hidden from OpenAPI and carries no credentials or financial values. Permit access only from Prometheus using the future approved NetworkPolicy; do not publish it through the web ingress.

Metrics:

- `monikey_api_requests_total{method,route,status}` — request counter with fixed route templates and bounded method/status values.
- `monikey_api_request_duration_seconds{method,route,status}` — request latency histogram.
- `monikey_database_connected` — most recent DB probe result (also refreshed on each scrape).
- `monikey_ledger_invariant_failures_total` — label-free counter for debit/credit validation rejection or PostgreSQL's deferred balanced-journal constraint failure. It resets on API restart; Prometheus retains samples.

Request IDs, user IDs, resource IDs, query values, amounts, descriptions, email addresses, cookies, and request bodies are never labels. The in-memory counters reset on API process restart; Prometheus retains historical samples.

`MoniKeyLedgerInvariantFailure` alerts when this counter increases during a
ten-minute window. It is deliberately separate from generic 5xx request
metrics, which cannot identify a journal-balance invariant failure reliably.

## Setup package

- `monikey-alerts.yml` provides application, database, error-rate, latency, journal-invariant, backup freshness/failure/storage/metrics validity, scheduled and pre-migration backup Job failure, migration, and TLS expiry alert rules. Backup exporter and Kubernetes metric names are matched to the V2 manifests; live metric availability still needs verification.
- `monikey-v2-extra-scrape-config.yaml` is a chart-ready `extraScrapeConfigs` fragment for the exact pinned Prometheus Helm chart version 25.19.1 in the audited GitOps repository. It scrapes the V2 API and the V2 backup-metrics Service directly, yielding the `monikey-v2-api` and `monikey-v2-backup` job labels expected by the rules without requiring Kubernetes discovery RBAC. The chart's pinned values schema was inspected locally; this fragment has not been merged into upstream values or tested against live DNS/network policy.
- `monikey-v2-overview.json` is an importable Grafana dashboard with API availability, DB status, request rate, server-error rate, p95 latency, and a red-threshold ten-minute journal-invariant failure count.

The API error-rate and latency rules require more than ten requests in ten
minutes to avoid noisy alerts from small denominators. The backup freshness
rule also fires when the expected last-success metric has never been scraped.
The backup-volume alert fires when less than ten percent of capacity is free or
when available bytes fall below the last successful archive size for fifteen
minutes. The latter is a baseline headroom check, not a guarantee that a larger
next dump will fit.
P6-06 writes those `monikey_backup_*` values to `/backups/metrics.prom`; the
V2 backup-metrics exporter reads that file from a read-only PVC mount and
serves an allowlisted set at `/metrics`. The scrape target and NetworkPolicy
are packaged, but no live scrape was performed.

Migration and certificate alerts select namespace `monikey-v2`, matching the V2 manifests. Do not promote the rules until the operator verifies `kube-state-metrics` and cert-manager metrics targets and Alertmanager routing. The audited upstream Prometheus commit currently has Alertmanager disabled.

Run these from the repository root with Docker to check syntax and verify the
alert stays quiet at zero and fires after a counter increase:

```sh
docker run --rm --entrypoint=/bin/promtool \
  -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.5.0 check rules /etc/prometheus/monikey-alerts.yml
docker run --rm --entrypoint=/bin/promtool \
  -v "$PWD/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.5.0 test rules /etc/prometheus/monikey-alerts.test.yml
```

The API scrape fragment and alert rule bundle were validated together using
Prometheus `promtool` 3.5.0 against the pinned chart's `extraScrapeConfigs`
value structure. The check proves configuration syntax and rule parsing only;
it does not prove service DNS, network reachability, metric availability, or
notification delivery in the homelab.
