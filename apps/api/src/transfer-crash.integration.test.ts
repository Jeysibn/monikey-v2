import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount } from "./accounts.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const databaseUrl = requireDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test("killing the API during a transfer posting rolls back the whole transaction", async () => {
  const ownerResult = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email_normalized = 'crash@example.test'",
  );
  const userId = ownerResult.rows[0]?.id;
  assert.ok(userId, "the seeded crash-test user must exist");

  const fixtureClient = await pool.connect();
  let sourceId: string;
  let destinationId: string;
  try {
    await fixtureClient.query("BEGIN");
    const source = await createFinancialAccount(
      fixtureClient,
      userId,
      {
        type: "BANK",
        name: `Crash source ${randomUUID()}`,
        openingBalanceMinor: "100000",
      },
      "2026-10-22",
    );
    const destination = await createFinancialAccount(
      fixtureClient,
      userId,
      {
        type: "EWALLET",
        name: `Crash destination ${randomUUID()}`,
        openingBalanceMinor: "100000",
      },
      "2026-10-22",
    );
    sourceId = source.id;
    destinationId = destination.id;
    await fixtureClient.query("COMMIT");
  } catch (error) {
    await fixtureClient.query("ROLLBACK");
    throw error;
  } finally {
    fixtureClient.release();
  }

  const lockKeyA = Math.floor(Math.random() * 2_000_000_000) + 1;
  const lockKeyB = Math.floor(Math.random() * 2_000_000_000) + 1;
  const lockClient = await pool.connect();
  let child: ChildProcess | undefined;
  let triggerInstalled = false;
  let serverPort: number | undefined;
  let transferPromise:
    | Promise<{ response?: Response; error?: unknown }>
    | undefined;
  const abortController = new AbortController();
  const suffix = randomUUID().replaceAll("-", "");
  const triggerName = `monikey_crash_${suffix}`;
  const functionName = `${triggerName}_fn`;

  try {
    await lockClient.query("SELECT pg_advisory_lock($1, $2)", [
      lockKeyA,
      lockKeyB,
    ]);
    await pool.query(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $body$
       BEGIN
         IF NEW.user_id = '${userId}'::uuid THEN
           PERFORM pg_advisory_xact_lock(${lockKeyA}, ${lockKeyB});
         END IF;
         RETURN NEW;
       END $body$`,
    );
    await pool.query(
      `CREATE TRIGGER ${triggerName} AFTER INSERT ON postings
       FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    triggerInstalled = true;

    const portProbe = createServer();
    portProbe.listen(0, "127.0.0.1");
    await once(portProbe, "listening");
    serverPort = (portProbe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
    const origin = `http://127.0.0.1:${serverPort}`;
    child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        API_PORT: String(serverPort),
        APP_ORIGIN: origin,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let childError = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      childError = (childError + chunk.toString()).slice(-4000);
    });
    child.once("error", (error) => {
      childError += error.message;
    });

    const readyDeadline = Date.now() + 20_000;
    while (Date.now() < readyDeadline) {
      if (child.exitCode !== null)
        throw new Error(`API exited early: ${childError}`);
      try {
        const ready = await fetch(`${origin}/api/v1/health/ready`);
        if (ready.ok) break;
      } catch {
        // Wait for Fastify startup and its database pool.
      }
      await delay(100);
    }
    const ready = await fetch(`${origin}/api/v1/health/ready`).catch(
      () => undefined,
    );
    assert.ok(ready?.ok, `isolated API did not become ready: ${childError}`);

    const login = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        email: "crash@example.test",
        password: "CI-only-crash-user-password-never-used",
      }),
    });
    const loginText = await login.text();
    assert.equal(login.status, 200, loginText);
    const loginBody = JSON.parse(loginText) as { csrfToken: string };
    const cookies = login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; ");
    assert.match(cookies, /__Host-mk_session=/);

    const idempotencyKey = `fin019-crash-${randomUUID()}`;
    transferPromise = fetch(`${origin}/api/v1/transactions`, {
      method: "POST",
      headers: {
        origin,
        cookie: cookies,
        "content-type": "application/json",
        "x-csrf-token": loginBody.csrfToken,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        kind: "TRANSFER",
        fromAccountId: sourceId,
        toAccountId: destinationId,
        amountMinor: "25000",
        occurredOn: "2026-10-22",
        note: "FIN-019 process crash",
      }),
      signal: abortController.signal,
    }).then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );

    const blockedDeadline = Date.now() + 15_000;
    let blocked = false;
    while (Date.now() < blockedDeadline) {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND wait_event = 'advisory'
            AND query ILIKE '%INSERT INTO postings%'`,
      );
      if (Number(result.rows[0]?.count) > 0) {
        blocked = true;
        break;
      }
      await delay(50);
    }
    assert.ok(
      blocked,
      "transfer did not reach the controlled mid-posting pause",
    );

    child.kill("SIGKILL");
    const [exitCode, signal] = await Promise.race([
      once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
      delay(10_000).then(() => {
        throw new Error("API child did not exit after SIGKILL");
      }),
    ]);
    assert.equal(exitCode, null);
    assert.equal(signal, "SIGKILL");
    abortController.abort();
    const transferResult = await transferPromise;
    assert.ok(
      transferResult?.error,
      "the in-flight request must lose its API connection",
    );

    await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
      lockKeyA,
      lockKeyB,
    ]);
    await delay(100);
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const artifacts = await pool.query<{
      transfers: string;
      journals: string;
      postings: string;
      idempotency: string;
    }>(
      `SELECT
         (SELECT count(*) FROM transactions WHERE user_id = $1 AND kind = 'TRANSFER' AND note = 'FIN-019 process crash')::text AS transfers,
         (SELECT count(*) FROM journals j JOIN transactions t ON t.id = j.transaction_id AND t.user_id = j.user_id WHERE j.user_id = $1 AND j.operation_kind = 'TRANSFER' AND t.note = 'FIN-019 process crash')::text AS journals,
         (SELECT count(*) FROM postings p JOIN journals j ON j.id = p.journal_id AND j.user_id = p.user_id JOIN transactions t ON t.id = j.transaction_id AND t.user_id = j.user_id WHERE p.user_id = $1 AND t.note = 'FIN-019 process crash')::text AS postings,
         (SELECT count(*) FROM idempotency_keys WHERE user_id = $1 AND key_hash = $2)::text AS idempotency`,
      [userId, keyHash],
    );
    assert.deepEqual(artifacts.rows[0], {
      transfers: "0",
      journals: "0",
      postings: "0",
      idempotency: "0",
    });
    const balances = await pool.query<{ id: string; balance_minor: string }>(
      `SELECT fa.id, COALESCE(sum(CASE WHEN p.direction = 'DEBIT' THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS balance_minor
         FROM financial_accounts fa
         JOIN ledger_accounts la ON la.financial_account_id = fa.id AND la.user_id = fa.user_id
         LEFT JOIN postings p ON p.ledger_account_id = la.id AND p.user_id = fa.user_id
        WHERE fa.user_id = $1 AND fa.id = ANY($2::uuid[])
        GROUP BY fa.id ORDER BY fa.id`,
      [userId, [sourceId, destinationId]],
    );
    assert.equal(balances.rowCount, 2);
    assert.ok(balances.rows.every((row) => row.balance_minor === "100000"));
  } finally {
    abortController.abort();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([once(child, "exit"), delay(2_000)]).catch(
        () => undefined,
      );
    }
    await lockClient
      .query("SELECT pg_advisory_unlock_all()")
      .catch(() => undefined);
    lockClient.release();
    if (triggerInstalled) {
      await pool
        .query(`DROP TRIGGER IF EXISTS ${triggerName} ON postings`)
        .catch(() => undefined);
      await pool
        .query(`DROP FUNCTION IF EXISTS ${functionName}()`)
        .catch(() => undefined);
    }
    await pool
      .query(
        "UPDATE financial_accounts SET archived_at = now() WHERE id = ANY($1::uuid[])",
        [[sourceId, destinationId]],
      )
      .catch(() => undefined);
  }
});
