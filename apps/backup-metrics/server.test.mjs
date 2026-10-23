import assert from "node:assert/strict";
import test from "node:test";

import { metricNames, renderMetricsFile } from "./server.mjs";

const validFile = metricNames.map((name, index) => `${name} ${index}`).join("\n");

test("exports only the five known backup metrics from a valid file", () => {
  const rendered = renderMetricsFile(validFile);
  assert.match(rendered, /monikey_backup_metrics_file_present 1/);
  assert.match(rendered, /monikey_backup_metrics_file_valid 1/);
  for (const name of metricNames) assert.match(rendered, new RegExp(`^${name} `, "m"));
});

test("reports a missing metrics file without inventing a successful backup", () => {
  const rendered = renderMetricsFile("", false);
  assert.match(rendered, /monikey_backup_metrics_file_present 0/);
  assert.match(rendered, /monikey_backup_metrics_file_valid 0/);
  assert.doesNotMatch(rendered, /monikey_backup_last_success_timestamp_seconds /);
});

test("rejects unexpected, duplicate, labeled, or malformed metrics", () => {
  for (const badContents of [
    `${validFile}\nmonikey_backup_extra 1`,
    `${validFile}\n${metricNames[0]} 99`,
    validFile.replace(`${metricNames[0]} 0`, `${metricNames[0]}{secret="x"} 0`),
    validFile.replace(`${metricNames[0]} 0`, `${metricNames[0]} NaN`),
  ]) {
    const rendered = renderMetricsFile(badContents);
    assert.match(rendered, /monikey_backup_metrics_file_valid 0/);
    assert.doesNotMatch(rendered, /monikey_backup_last_run_success /);
  }
});

test("rejects impossible success, timestamp, and storage metric values", () => {
  for (const badContents of [
    validFile.replace(`${metricNames[0]} 0`, `${metricNames[0]} 2`),
    validFile.replace(
      `${metricNames[1]} 1`,
      `${metricNames[1]} 1.5`,
    ),
    validFile.replace(
      `${metricNames[3]} 3`,
      `${metricNames[3]} 100`,
    ),
    validFile.replace(
      `${metricNames[4]} 4`,
      `${metricNames[4]} 1`,
    ),
  ]) {
    const rendered = renderMetricsFile(badContents);
    assert.match(rendered, /monikey_backup_metrics_file_valid 0/);
    assert.doesNotMatch(rendered, /monikey_backup_last_run_success /);
  }
});
