import argon2 from "argon2";
import { Pool } from "pg";

const email = process.env.MONIKEY_E2E_EMAIL?.trim().toLowerCase();
const password = process.env.MONIKEY_E2E_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (
  process.env.NODE_ENV !== "test" ||
  process.env.ALLOW_E2E_USER_SEED !== "true"
) {
  console.error(
    "The secondary-user seed command is restricted to explicit E2E runs.",
  );
  process.exit(1);
}

if (!email || !password || !databaseUrl) {
  console.error(
    "Set MONIKEY_E2E_EMAIL, MONIKEY_E2E_PASSWORD, and DATABASE_URL.",
  );
  process.exit(1);
}

if (
  email.length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  password.length < 12 ||
  password.length > 128
) {
  console.error("The E2E account credentials do not meet validation rules.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(704218340)");
  const count = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM users",
  );
  if (Number(count.rows[0]?.count ?? 0) < 1) {
    throw new Error("The E2E disposable user requires a bootstrapped owner.");
  }
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE email_normalized = $1",
    [email],
  );
  if (existing.rowCount) {
    throw new Error("The requested E2E user already exists.");
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const user = await client.query<{ id: string }>(
    "INSERT INTO users (email_normalized, password_hash) VALUES ($1, $2) RETURNING id",
    [email, passwordHash],
  );
  await client.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [
    user.rows[0]!.id,
  ]);
  await client.query("COMMIT");
  console.log("Disposable E2E secondary user created.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    error instanceof Error ? error.message : "E2E user seeding failed.",
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
