# Observability contract

MoniKey V2 exports low-cardinality API metrics for the existing homelab
Prometheus and emits redacted structured API logs for the existing Alloy/Loki
pipeline. It does not deploy a second monitoring stack.

## API metrics

`GET /metrics` is a private scrape endpoint, hidden from OpenAPI and intended
to be reachable only from the approved Prometheus workload after the
production NetworkPolicy is reviewed. It is not served by the web frontend.
Each scrape performs a `SELECT 1` through the API pool and refreshes the
database-connected gauge.

- `monikey_api_requests_total{method,route,status}` counts completed requests.
- `monikey_api_request_duration_seconds{method,route,status}` records latency
  histogram buckets, sum, and count.
- `monikey_database_connected` reports the most recent scrape-time PostgreSQL
  check.
- `monikey_ledger_invariant_failures_total` counts app-side debit/credit
  invariant rejections and PostgreSQL deferred journal-balance constraint
  failures. It has no labels and resets when the API restarts.

Route labels use Fastify route templates; unmatched paths collapse to a single
`unmatched` label. Query strings are excluded. No user/resource IDs, request
IDs, credentials, amounts, or financial descriptions are exported. The API
keeps counters in process memory, so they reset on restart; Prometheus samples
provide historical continuity.

## Dashboards and rules

`monitoring/grafana/monikey-v2-overview.json` is an importable overview with a red-threshold stat panel for the ten-minute journal-invariant failure count.
`monitoring/prometheus/monikey-alerts.yml` contains twelve rules for scrape
availability, database health, elevated 5xx rate and latency, overdue/failed
backups, backup metrics validity, low backup-volume space, failed scheduled or
pre-migration backup Jobs, failed migration Jobs, and expiring TLS.
The error-rate and latency alerts require more than ten requests in ten minutes
to avoid unstable ratios from the app's low-volume traffic. Backup freshness
also alerts when its expected metric series is absent. The file was checked
with Prometheus `promtool` 3.5.0 locally. A `promtool test rules` case also
verifies the journal-invariant alert stays quiet at zero and fires after the
counter increases and its one-minute `for` interval elapses. The same rule test
suite covers missing/overdue backup, failed backup, invalid backup metrics,
low backup-volume alerts, and scheduled/pre-migration backup Job failures. A
fresh success timestamp stays clear of the overdue alert. The suite checks
grace periods and firing labels/annotations.

Backup metrics are written atomically to the backup PVC's `metrics.prom` file
by the P6-06 CronJob. The V2 backup-metrics exporter mounts that PVC read-only
and validates/allowlists the five known metrics. It also rejects nonbinary run
status, fractional timestamps/byte counts, free bytes greater than total
volume bytes, and a claimed successful run without a timestamp and nonempty
archive. Invalid files expose only the file-present and file-valid gauges, so
bad backup state cannot masquerade as a successful backup series. The exporter
serves data through a monitoring-only Service/NetworkPolicy. A chart-ready static API and backup
scrape target is in `monitoring/prometheus/monikey-v2-extra-scrape-config.yaml`.
Kubernetes Job selectors, cert-manager selectors, and target availability
still need live reconciliation. The scrape config targets
`monitoring/prometheus/monikey-v2-extra-scrape-config.yaml`; it targets
`api.monikey-v2.svc.cluster.local:3000` and
`backup-metrics.monikey-v2.svc.cluster.local:9100`; it does not require Kubernetes API
discovery permissions. It uses the pinned Prometheus chart's
`extraScrapeConfigs` value and the matching NetworkPolicy source namespace.
Migration and TLS alert selectors use the V2 namespace `monikey-v2`. The
`MoniKeyLedgerInvariantFailure` alert fires when the counter increases during a
ten-minute window. Alertmanager is disabled in the audited upstream commit;
these rules cannot notify anyone until routing is enabled through an approved
homelab change.

## Release gates

The endpoint and config package have local unit, real API/PostgreSQL Playwright,
exporter unit tests, JSON/YAML, Prometheus rule validation, and a rule-behavior
test for the journal-invariant alert. Still
required are live scrape connectivity and NetworkPolicy, exact live labels/exporters, Alertmanager
delivery, backup and migration signal wiring, Loki redaction/ingestion review,
and owner-approved GitOps integration. No upstream monitoring or cluster files
were changed as part of this implementation.
