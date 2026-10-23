import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

export const metricNames = [
  "monikey_backup_last_run_success",
  "monikey_backup_last_success_timestamp_seconds",
  "monikey_backup_last_archive_size_bytes",
  "monikey_backup_volume_available_bytes",
  "monikey_backup_volume_size_bytes",
];

const numericValue = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const integerMetricNames = new Set([
  "monikey_backup_last_success_timestamp_seconds",
  "monikey_backup_last_archive_size_bytes",
  "monikey_backup_volume_available_bytes",
  "monikey_backup_volume_size_bytes",
]);

export function renderMetricsFile(contents, present = true) {
  const parsed = new Map();
  let valid = present;
  if (present) {
    for (const line of contents.split(/\r?\n/)) {
      if (!line) continue;
      const match = /^(monikey_backup_[a-z_]+) (\S+)$/.exec(line);
      if (
        !match ||
        !metricNames.includes(match[1]) ||
        !numericValue.test(match[2]) ||
        (integerMetricNames.has(match[1]) && !/^(?:0|[1-9][0-9]*)$/.test(match[2])) ||
        parsed.has(match[1])
      ) {
        valid = false;
        break;
      }
      parsed.set(match[1], match[2]);
    }
    valid &&= metricNames.every((name) => parsed.has(name));
    if (valid) {
      const lastRunSuccess = BigInt(parsed.get("monikey_backup_last_run_success"));
      const lastSuccessTimestamp = BigInt(
        parsed.get("monikey_backup_last_success_timestamp_seconds"),
      );
      const lastArchiveSize = BigInt(
        parsed.get("monikey_backup_last_archive_size_bytes"),
      );
      const availableBytes = BigInt(
        parsed.get("monikey_backup_volume_available_bytes"),
      );
      const volumeSize = BigInt(
        parsed.get("monikey_backup_volume_size_bytes"),
      );
      valid &&=
        (lastRunSuccess === 0n || lastRunSuccess === 1n) &&
        availableBytes <= volumeSize &&
        lastArchiveSize <= volumeSize &&
        (lastRunSuccess === 0n ||
          (lastSuccessTimestamp > 0n && lastArchiveSize > 0n));
    }
  }

  const lines = [
    "# HELP monikey_backup_metrics_file_present Whether the backup metrics file is readable.",
    "# TYPE monikey_backup_metrics_file_present gauge",
    `monikey_backup_metrics_file_present ${present ? 1 : 0}`,
    "# HELP monikey_backup_metrics_file_valid Whether the backup metrics file passed validation.",
    "# TYPE monikey_backup_metrics_file_valid gauge",
    `monikey_backup_metrics_file_valid ${valid ? 1 : 0}`,
  ];
  if (valid) {
    for (const name of metricNames) lines.push(`${name} ${parsed.get(name)}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function readBackupMetrics(path = "/backups/metrics.prom") {
  try {
    const contents = await readFile(path, "utf8");
    return renderMetricsFile(contents, true);
  } catch {
    return renderMetricsFile("", false);
  }
}

export function createMetricsServer({
  path = "/backups/metrics.prom",
  host = "0.0.0.0",
  port = 9100,
} = {}) {
  const server = createServer(async (request, response) => {
    if (request.url === "/health/live" || request.url === "/health/ready") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok\n");
      return;
    }
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
    response.end(await readBackupMetrics(path));
  });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? "9100");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  createMetricsServer({ port });
}
