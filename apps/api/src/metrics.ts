import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getLedgerInvariantFailures } from "./ledger/invariant-metrics.js";

const durationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
type MetricSeries = {
  count: number;
  sumSeconds: number;
  buckets: number[];
};

export class ApiMetrics {
  private readonly requests = new Map<string, MetricSeries>();
  private databaseConnected = 0;

  record(method: string, route: string, statusCode: number, seconds: number) {
    const key = `${method}|${route}|${statusCode}`;
    const series = this.requests.get(key) ?? {
      count: 0,
      sumSeconds: 0,
      buckets: durationBuckets.map(() => 0),
    };
    series.count += 1;
    series.sumSeconds += seconds;
    durationBuckets.forEach((bound, index) => {
      if (seconds <= bound)
        series.buckets[index] = (series.buckets[index] ?? 0) + 1;
    });
    this.requests.set(key, series);
  }

  setDatabaseConnected(connected: boolean) {
    this.databaseConnected = connected ? 1 : 0;
  }

  render(): string {
    const lines = [
      "# HELP monikey_api_requests_total Completed HTTP requests.",
      "# TYPE monikey_api_requests_total counter",
    ];
    for (const [key, series] of this.requests) {
      const [method = "unknown", route = "unmatched", status = "500"] =
        key.split("|");
      const labels = `method="${method}",route="${route}",status="${status}"`;
      lines.push(`monikey_api_requests_total{${labels}} ${series.count}`);
    }
    lines.push(
      "# HELP monikey_api_request_duration_seconds HTTP request duration.",
      "# TYPE monikey_api_request_duration_seconds histogram",
    );
    for (const [key, series] of this.requests) {
      const [method = "unknown", route = "unmatched", status = "500"] =
        key.split("|");
      const labels = `method="${method}",route="${route}",status="${status}"`;
      durationBuckets.forEach((bound, index) => {
        lines.push(
          `monikey_api_request_duration_seconds_bucket{${labels},le="${bound}"} ${series.buckets[index]}`,
        );
      });
      lines.push(
        `monikey_api_request_duration_seconds_bucket{${labels},le="+Inf"} ${series.count}`,
        `monikey_api_request_duration_seconds_sum{${labels}} ${series.sumSeconds}`,
        `monikey_api_request_duration_seconds_count{${labels}} ${series.count}`,
      );
    }
    lines.push(
      "# HELP monikey_database_connected Whether the API can query PostgreSQL.",
      "# TYPE monikey_database_connected gauge",
      `monikey_database_connected ${this.databaseConnected}`,
      "# HELP monikey_ledger_invariant_failures_total Journal balance invariant violations.",
      "# TYPE monikey_ledger_invariant_failures_total counter",
      `monikey_ledger_invariant_failures_total ${getLedgerInvariantFailures()}`,
      "",
    );
    return lines.join("\n");
  }
}

export function normalizeMetricRoute(request: FastifyRequest): string {
  const template = request.routeOptions.url;
  if (template?.startsWith("/api/v1/")) return template;
  return "unmatched";
}

export function registerMetrics(app: FastifyInstance, pool: Pool | undefined) {
  const metrics = new ApiMetrics();
  const startedAt = new WeakMap<FastifyRequest, bigint>();
  app.addHook("onRequest", async (request) => {
    startedAt.set(request, process.hrtime.bigint());
  });
  app.addHook("onResponse", async (request, reply) => {
    const started = startedAt.get(request);
    if (started === undefined || request.url === "/metrics") return;
    metrics.record(
      request.method,
      normalizeMetricRoute(request),
      reply.statusCode,
      Number(process.hrtime.bigint() - started) / 1_000_000_000,
    );
  });
  app.get("/metrics", { schema: { hide: true } }, async (_request, reply) => {
    let connected = false;
    if (pool) {
      try {
        await pool.query("SELECT 1");
        connected = true;
      } catch {
        connected = false;
      }
    }
    metrics.setDatabaseConnected(connected);
    return reply
      .header("Cache-Control", "no-store")
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.render());
  });
  return metrics;
}
