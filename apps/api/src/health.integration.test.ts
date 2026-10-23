import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Pool } from "pg";

type HealthBody = {
  status: "ok" | "degraded";
  database: "connected" | "unconfigured" | "unavailable";
};

type ApiProcess = {
  child: ChildProcess;
  origin: string;
  stop: () => Promise<void>;
};

const isolatedDatabaseUrl = process.env.MONIKEY_HEALTH_TEST_DATABASE_URL;

test(
  "liveness stays healthy without configuration while readiness fails closed",
  { timeout: 30_000 },
  async () => {
    const api = await startApi();
    try {
      const live = await get(api.origin, "/api/v1/health/live");
      assert.equal(live.status, 200);
      assert.deepEqual(await live.json(), { status: "ok" });

      for (const path of ["/api/v1/health/ready", "/api/v1/health"]) {
        const response = await get(api.origin, path);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          status: "degraded",
          database: "unconfigured",
        });
      }

      const metrics = await get(api.origin, "/metrics");
      assert.equal(metrics.status, 200);
      assert.match(await metrics.text(), /monikey_database_connected 0/);
    } finally {
      await api.stop();
    }
  },
);

test(
  "readiness bounds database checks and recovers after PostgreSQL connectivity returns",
  {
    timeout: 45_000,
    skip: isolatedDatabaseUrl
      ? false
      : "Set MONIKEY_HEALTH_TEST_DATABASE_URL to an isolated temporary PostgreSQL database.",
  },
  async () => {
    const destination = new URL(isolatedDatabaseUrl!);
    const destinationHost = decodeURIComponent(destination.hostname);
    const destinationPort = Number(destination.port || 5432);
    assert.ok(destinationHost, "the isolated test database must use TCP");

    const databaseProbe = new Pool({
      connectionString: isolatedDatabaseUrl,
      connectionTimeoutMillis: 2_000,
      query_timeout: 2_000,
    });
    await databaseProbe.query("SELECT 1");
    await databaseProbe.end();

    const proxy = new DatabaseTcpProxy(destinationHost, destinationPort);
    const proxyPort = await proxy.start();
    const proxiedDatabaseUrl = new URL(isolatedDatabaseUrl!);
    proxiedDatabaseUrl.hostname = "127.0.0.1";
    proxiedDatabaseUrl.port = String(proxyPort);

    const api = await startApi(proxiedDatabaseUrl.toString());
    try {
      await waitForHealth(api.origin, "/api/v1/health/ready", 200, "connected");
      const legacyHealth = await get(api.origin, "/api/v1/health");
      assert.equal(legacyHealth.status, 200);
      assert.deepEqual(await legacyHealth.json(), {
        status: "ok",
        database: "connected",
      });

      await proxy.stop();
      const unavailableStartedAt = Date.now();
      await waitForHealth(
        api.origin,
        "/api/v1/health/ready",
        503,
        "unavailable",
      );
      assert.ok(
        Date.now() - unavailableStartedAt < 5_000,
        "a failed database probe must return within a bounded interval",
      );

      const legacyUnavailable = await get(api.origin, "/api/v1/health");
      assert.equal(legacyUnavailable.status, 503);
      assert.deepEqual(await legacyUnavailable.json(), {
        status: "degraded",
        database: "unavailable",
      });
      const liveDuringOutage = await get(api.origin, "/api/v1/health/live");
      assert.equal(liveDuringOutage.status, 200);
      const metricsDuringOutage = await get(api.origin, "/metrics");
      assert.equal(metricsDuringOutage.status, 200);
      assert.match(
        await metricsDuringOutage.text(),
        /monikey_database_connected 0/,
      );

      await proxy.start(proxyPort);
      await waitForHealth(api.origin, "/api/v1/health/ready", 200, "connected");
      const legacyRecovered = await get(api.origin, "/api/v1/health");
      assert.equal(legacyRecovered.status, 200);
      const recoveredBody = (await legacyRecovered.json()) as HealthBody;
      assert.deepEqual(recoveredBody, {
        status: "ok",
        database: "connected",
      });
      assert.deepEqual(Object.keys(recoveredBody).sort(), [
        "database",
        "status",
      ]);
      const metricsRecovered = await get(api.origin, "/metrics");
      assert.equal(metricsRecovered.status, 200);
      assert.match(
        await metricsRecovered.text(),
        /monikey_database_connected 1/,
      );
    } finally {
      await api.stop();
      await proxy.stop();
    }
  },
);

async function startApi(databaseUrl?: string): Promise<ApiProcess> {
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    API_PORT: String(port),
    APP_ORIGIN: origin,
    NODE_ENV: "test",
  };
  if (databaseUrl) environment.DATABASE_URL = databaseUrl;
  else delete environment.DATABASE_URL;

  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: environment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let childError = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const sanitized = chunk
      .toString()
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted database URL]");
    childError = (childError + sanitized).slice(-4_000);
  });
  child.once("error", (error) => {
    childError = (childError + error.message).slice(-4_000);
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API process exited before startup: ${childError}`);
    }
    try {
      const response = await get(origin, "/api/v1/health/live", 1_000);
      if (response.status === 200) {
        return {
          child,
          origin,
          stop: () => stopChild(child),
        };
      }
    } catch {
      // Wait for Fastify to start listening.
    }
    await delay(100);
  }
  await stopChild(child);
  throw new Error(`API process did not start: ${childError}`);
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exit.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (stopped) return;
  const killed = once(child, "exit");
  child.kill("SIGKILL");
  await killed;
}

async function get(
  origin: string,
  path: string,
  timeoutMs = 4_000,
): Promise<Response> {
  return fetch(`${origin}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
}

async function waitForHealth(
  origin: string,
  path: string,
  status: number,
  database: HealthBody["database"],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await get(origin, path, 3_000);
      const body = (await response.json()) as HealthBody;
      if (response.status === status && body.database === database) return;
    } catch {
      // The proxy may be reconnecting or the API may be finishing its timeout.
    }
    await delay(100);
  }
  throw new Error(`Health endpoint did not reach expected database state.`);
}

class DatabaseTcpProxy {
  private server: ReturnType<typeof createServer> | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly destinationHost: string,
    private readonly destinationPort: number,
  ) {}

  async start(port = 0): Promise<number> {
    if (this.server?.listening) {
      return (this.server.address() as { port: number }).port;
    }

    const server = createServer((client) => {
      this.sockets.add(client);
      client.once("close", () => this.sockets.delete(client));
      const upstream = createServerSocket(
        this.destinationHost,
        this.destinationPort,
      );
      this.sockets.add(upstream);
      upstream.once("close", () => this.sockets.delete(upstream));
      client.once("error", () => upstream.destroy());
      upstream.once("error", () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
    this.server = server;
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server?.listening) return;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    this.server = undefined;
  }
}

function createServerSocket(host: string, port: number): Socket {
  return createConnection({ host, port });
}
