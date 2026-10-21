import argon2 from "argon2";
import { Pool } from "pg";

const email = process.env.MONIKEY_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.MONIKEY_BOOTSTRAP_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!email || !password || !databaseUrl) {
  console.error(
    "Set MONIKEY_BOOTSTRAP_EMAIL, MONIKEY_BOOTSTRAP_PASSWORD, and DATABASE_URL.",
  );
  process.exit(1);
}

if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("The owner email address is invalid.");
  process.exit(1);
}

if (password.length < 12 || password.length > 128) {
  console.error("The owner password must be between 12 and 128 characters.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(704218339)");
  const count = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM users",
  );
  if (count.rows[0]?.count !== "0") {
    throw new Error("Owner bootstrap is disabled after the first user exists.");
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
  console.log("Private owner account created. Bootstrap is now disabled.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    error instanceof Error ? error.message : "Owner bootstrap failed.",
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
