import { Pool } from "pg";
import { moneyMinor } from "@monikey/money";
import { postBalancedJournal } from "./ledger/service.js";
import { createFinancialAccount } from "./accounts.js";
import { ensureDefaultCategories } from "./categories.js";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.MONIKEY_SCALE_EMAIL?.trim().toLowerCase();
const count = Number(process.env.MONIKEY_SCALE_COUNT ?? "10000");

if (
  process.env.NODE_ENV !== "test" ||
  process.env.ALLOW_E2E_SCALE_SEED !== "true" ||
  !databaseUrl ||
  !email ||
  !Number.isSafeInteger(count) ||
  count < 10000 ||
  count > 20000
) {
  console.error(
    "Scale seed requires test mode, explicit opt-in, an E2E database, an email, and 10,000–20,000 rows.",
  );
  process.exit(1);
}

const parsedUrl = new URL(databaseUrl);
const allowedHosts = new Set(["db", "localhost", "127.0.0.1", "::1"]);
if (
  parsedUrl.protocol !== "postgresql:" ||
  parsedUrl.pathname !== "/monikey_e2e" ||
  !allowedHosts.has(parsedUrl.hostname)
) {
  console.error("Scale seed is restricted to the local monikey_e2e database.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const owner = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE email_normalized = $1",
    [email],
  );
  const userId = owner.rows[0]?.id;
  if (!userId) throw new Error("Scale review user was not found.");
  await ensureDefaultCategories(client, userId);

  const account = await client.query<{ id: string }>(
    "SELECT id FROM financial_accounts WHERE user_id = $1 AND name = 'Local Scale Review'",
    [userId],
  );
  if (account.rowCount) {
    throw new Error("Scale review fixture already exists for this user.");
  }

  const category = await client.query<{ id: string }>(
    `SELECT id FROM categories WHERE user_id = $1 AND kind = 'EXPENSE' AND name = 'Food'`,
    [userId],
  );
  if (!category.rows[0]) throw new Error("Food category was not found.");
  const expenseLedger = await client.query<{ id: string }>(
    `SELECT id FROM ledger_accounts WHERE user_id = $1 AND category_id = $2`,
    [userId, category.rows[0].id],
  );
  if (!expenseLedger.rows[0])
    throw new Error("Food ledger account was not found.");

  const scaleAccount = await createFinancialAccount(
    client,
    userId,
    { type: "BANK", name: "Local Scale Review", openingBalanceMinor: "0" },
    "2026-10-01",
  );
  const scaleAccountLedger = await client.query<{ id: string }>(
    `SELECT id
       FROM ledger_accounts
      WHERE user_id = $1 AND financial_account_id = $2`,
    [userId, scaleAccount.id],
  );
  if (!scaleAccountLedger.rows[0]) {
    throw new Error("Scale review account ledger was not found.");
  }
  const startedAt = Date.now();
  for (let index = 0; index < count; index += 1) {
    const occurredOn = new Date(Date.UTC(2026, 9, 1 + (index % 23)))
      .toISOString()
      .slice(0, 10);
    const transaction = await client.query<{ id: string }>(
      `INSERT INTO transactions (user_id, kind, occurred_on, category_id, note)
       VALUES ($1, 'EXPENSE', $4::date, $2, $3)
       RETURNING id`,
      [
        userId,
        category.rows[0].id,
        `Scale review item ${index + 1}`,
        occurredOn,
      ],
    );
    const transactionId = transaction.rows[0]!.id;
    await client.query(
      `INSERT INTO transaction_revisions
         (user_id, transaction_id, version, before_json, after_json, actor_id)
       VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
      [
        userId,
        transactionId,
        JSON.stringify({
          kind: "EXPENSE",
          sourceAccountId: scaleAccount.id,
          categoryId: category.rows[0].id,
          amountMinor: "1",
          occurredOn,
          note: `Scale review item ${index + 1}`,
        }),
      ],
    );
    await postBalancedJournal(client, {
      userId,
      transactionId,
      operationKind: "EXPENSE",
      postings: [
        {
          ledgerAccountId: expenseLedger.rows[0].id,
          direction: "DEBIT",
          amountMinor: moneyMinor("1"),
        },
        {
          ledgerAccountId: scaleAccountLedger.rows[0].id,
          direction: "CREDIT",
          amountMinor: moneyMinor("1"),
        },
      ],
    });
    if ((index + 1) % 1000 === 0) {
      console.log(`Seeded ${index + 1}/${count} balanced ledger entries.`);
    }
  }

  await client.query("COMMIT");
  console.log(
    `Created ${count} real ledger entries in ${Date.now() - startedAt} ms.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    error instanceof Error ? error.message : "Scale seeding failed.",
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
