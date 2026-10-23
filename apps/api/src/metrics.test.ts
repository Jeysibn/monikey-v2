import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { ApiMetrics, normalizeMetricRoute } from "./metrics.js";
import {
  getLedgerInvariantFailures,
  recordDatabaseLedgerInvariantFailure,
  recordLedgerInvariantFailure,
  recordLedgerInvariantValidationFailure,
} from "./ledger/invariant-metrics.js";
import {
  LedgerBalanceInvariantError,
  LedgerValidationError,
} from "./ledger/domain.js";

test("Prometheus metrics use only bounded route, method and status labels", () => {
  const metrics = new ApiMetrics();
  metrics.record("GET", "/api/v1/accounts/:id", 200, 0.012);
  metrics.setDatabaseConnected(true);
  const output = metrics.render();

  assert.match(
    output,
    /monikey_api_requests_total\{method="GET",route="\/api\/v1\/accounts\/:id",status="200"\} 1/,
  );
  assert.match(output, /monikey_database_connected 1/);
  assert.doesNotMatch(output, /user|amount|account-123|\?month=/i);
});

test("request duration histogram accumulates bounded buckets", () => {
  const metrics = new ApiMetrics();
  metrics.record("GET", "/api/v1/health/ready", 200, 0.008);
  metrics.record("GET", "/api/v1/health/ready", 503, 0.3);
  const output = metrics.render();

  assert.match(output, /le="0\.01"\} 1/);
  assert.match(output, /le="0\.25"\} 0/);
  assert.match(output, /le="\+Inf"\} 1/);
});

test("journal invariant failures export a label-free counter", () => {
  const before = getLedgerInvariantFailures();
  recordLedgerInvariantFailure();
  const metrics = new ApiMetrics();

  assert.match(
    metrics.render(),
    new RegExp(`monikey_ledger_invariant_failures_total ${before + 1}`),
  );
  assert.doesNotMatch(
    metrics.render(),
    /monikey_ledger_invariant_failures_total\{/,
  );
});

test("only journal-balance violations increment the invariant counter", () => {
  const before = getLedgerInvariantFailures();
  recordLedgerInvariantValidationFailure(
    new LedgerBalanceInvariantError("Journal debits and credits must balance."),
  );
  recordLedgerInvariantValidationFailure(
    new LedgerValidationError("Posting amount must be positive."),
  );
  recordDatabaseLedgerInvariantFailure({
    code: "23514",
    message:
      "Journal aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa must have at least two balanced postings",
  });
  recordDatabaseLedgerInvariantFailure({
    code: "23514",
    message: "Posting amount must be positive",
  });

  assert.equal(getLedgerInvariantFailures(), before + 2);
});

test("metric route normalization hides identifiers and query values", async () => {
  const app = Fastify();
  await app.get("/api/v1/accounts/:accountId", async () => ({ ok: true }));
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/accounts/personal-id-9f12?include=activity",
  });
  const request = {
    routeOptions: { url: "/api/v1/accounts/:accountId" },
    url: "/api/v1/accounts/personal-id-9f12?include=activity",
  } as FastifyRequest;

  assert.equal(response.statusCode, 200);
  assert.equal(normalizeMetricRoute(request), "/api/v1/accounts/:accountId");
  assert.equal(
    normalizeMetricRoute({
      routeOptions: {},
      url: "/not-registered/personal-id-9f12?email=private@example.test",
    } as FastifyRequest),
    "unmatched",
  );
  await app.close();
});
