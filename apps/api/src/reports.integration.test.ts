import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { createFinancialAccount } from "./accounts.js";
import { withReadOnlyRepeatableReadTransaction } from "./database.js";
import {
  csvCell,
  readMonthlyReport,
  type ExportTransaction,
  streamExportTransactionPages,
  streamTransactionsCsv,
  streamTransactionsJsonArray,
  transactionsCsv,
} from "./reports.js";
import {
  createIncomeOrExpense,
  createRefund,
  deleteTransaction,
} from "./transactions.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const pool = new Pool({ connectionString: requireDatabaseUrl() });
after(async () => pool.end());

async function collectExportRows(
  client: PoolClient,
  userId: string,
  from: string,
  to: string,
): Promise<ExportTransaction[]> {
  const rows: ExportTransaction[] = [];
  for await (const page of streamExportTransactionPages(
    client,
    userId,
    from,
    to,
  )) {
    rows.push(...page);
  }
  return rows;
}

test("monthly report nets refunds and exports owner-scoped exact minor units", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;
    const account = await createFinancialAccount(
      client,
      userId,
      {
        type: "BANK",
        name: "Reports test bank",
        openingBalanceMinor: "200000",
      },
      "2026-10-22",
    );
    const categories = await client.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM categories
        WHERE user_id = $1 AND name IN ('Food', 'Salary')`,
      [userId],
    );
    const food = categories.rows.find((row) => row.kind === "EXPENSE");
    const salary = categories.rows.find((row) => row.kind === "INCOME");
    assert.ok(food?.id);
    assert.ok(salary?.id);
    const expense = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: account.id,
        categoryId: food.id,
        amountMinor: "25000",
        occurredOn: "2025-01-10",
      },
      "2026-10-22",
    );
    await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "INCOME",
        sourceAccountId: account.id,
        categoryId: salary.id,
        amountMinor: "400000",
        occurredOn: "2025-01-11",
      },
      "2026-10-22",
    );
    await createRefund(
      client,
      userId,
      {
        kind: "REFUND",
        sourceAccountId: account.id,
        refundedTransactionId: expense.transaction.id,
        amountMinor: "10000",
        occurredOn: "2025-02-01",
      },
      "2026-10-22",
    );
    const report = await readMonthlyReport(client, userId, "2025-01");
    assert.equal(report.incomeMinor, "400000");
    assert.equal(report.netExpensesMinor, "25000");
    assert.equal(report.netCashFlowMinor, "375000");
    assert.equal(
      report.categories.find((row) => row.categoryId === food.id)?.amountMinor,
      "25000",
    );
    const refundMonth = await readMonthlyReport(client, userId, "2025-02");
    assert.equal(refundMonth.incomeMinor, "0");
    assert.equal(refundMonth.netExpensesMinor, "-10000");
    assert.equal(refundMonth.netCashFlowMinor, "10000");
    assert.equal(
      refundMonth.categories.find((row) => row.categoryId === food.id)
        ?.amountMinor,
      "-10000",
    );

    const exported = await collectExportRows(
      client,
      userId,
      "2025-01-01",
      "2025-01-31",
    );
    assert.ok(exported.some((row) => row.id === expense.transaction.id));

    await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: account.id,
        categoryId: food.id,
        amountMinor: "125",
        occurredOn: "2025-01-10",
        note: "\u0085=stream-safe",
      },
      "2026-10-22",
    );
    const expectedRows = await collectExportRows(
      client,
      userId,
      "2025-01-01",
      "2025-01-31",
    );
    const streamedPages: string[] = [];
    for await (const page of streamExportTransactionPages(
      client,
      userId,
      "2025-01-01",
      "2025-01-31",
      1,
    )) {
      assert.equal(page.length, 1);
      streamedPages.push(page[0]!.id);
    }
    assert.deepEqual(
      streamedPages,
      expectedRows.map((row) => row.id),
    );

    const csvChunks: string[] = [];
    for await (const chunk of streamTransactionsCsv(
      client,
      userId,
      "2025-01-01",
      "2025-01-31",
      1,
    )) {
      csvChunks.push(chunk);
    }
    const streamedCsv = csvChunks.join("");
    assert.match(streamedCsv, /'\u0085=stream-safe/);
    assert.match(streamedCsv, /\r\n$/);

    const jsonChunks: string[] = [];
    for await (const chunk of streamTransactionsJsonArray(
      client,
      userId,
      "2025-01-01",
      "2025-01-31",
      1,
    )) {
      jsonChunks.push(chunk);
    }
    const streamedJson = JSON.parse(`[${jsonChunks.join("")}]`) as {
      id: string;
      amountMinor: string;
    }[];
    assert.deepEqual(
      streamedJson.map((row) => row.id),
      expectedRows.map((row) => row.id),
    );
    assert.ok(streamedJson.every((row) => typeof row.amountMinor === "string"));

    const csv = transactionsCsv([
      { ...exported[0]!, note: "=unsafe", currentRevision: 1 },
    ]);
    assert.match(csv, /'=unsafe/);
    assert.equal(csvCell(" \t=unsafe"), '"\' \t=unsafe"');
    for (const marker of ["=", "+", "-", "@"] as const) {
      for (const prefix of ["\u0085", "\u007f", "\u009f", "\u00a0\t"]) {
        assert.equal(
          csvCell(`${prefix}${marker}unsafe`),
          `"'${prefix}${marker}unsafe"`,
        );
      }
    }
    assert.equal(csvCell("-500", false), '"-500"');
    assert.match(csv, /\r\n$/);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("monthly report totals and categories use one repeatable-read snapshot", async () => {
  const setupClient = await pool.connect();
  let userId: string;
  let accountId: string;
  let foodCategoryId: string;
  const probeNote = "Repeatable report snapshot probe";
  try {
    await setupClient.query("BEGIN");
    const owner = await setupClient.query<{ id: string }>(
      `SELECT id FROM users
        WHERE email_normalized = 'reports-snapshot@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    userId = owner.rows[0]!.id;
    const staleProbes = await setupClient.query<{ id: string }>(
      `SELECT id FROM transactions
        WHERE user_id = $1 AND note = $2 AND status = 'POSTED'`,
      [userId, probeNote],
    );
    for (const staleProbe of staleProbes.rows) {
      await deleteTransaction(
        setupClient,
        userId,
        staleProbe.id,
        {
          reason: "Clean up a prior report snapshot test run.",
        },
        "2026-10-24",
      );
    }
    const existingAccount = await setupClient.query<{ id: string }>(
      `SELECT id FROM financial_accounts
        WHERE user_id = $1 AND name = 'Repeatable report test bank'`,
      [userId],
    );
    if (existingAccount.rows[0]) {
      accountId = existingAccount.rows[0].id;
    } else {
      const account = await createFinancialAccount(
        setupClient,
        userId,
        {
          type: "BANK",
          name: "Repeatable report test bank",
          openingBalanceMinor: "100000",
        },
        "2026-10-22",
      );
      accountId = account.id;
    }
    const categories = await setupClient.query<{ id: string }>(
      `SELECT id FROM categories
        WHERE user_id = $1 AND name = 'Food' AND kind = 'EXPENSE'`,
      [userId],
    );
    assert.ok(categories.rows[0]?.id);
    foodCategoryId = categories.rows[0]!.id;
    await setupClient.query("COMMIT");
  } catch (error) {
    await setupClient.query("ROLLBACK");
    throw error;
  } finally {
    setupClient.release();
  }

  let injectedPosting = false;
  let probeTransactionId: string | undefined;
  const cleanupProbe = async () => {
    if (!probeTransactionId) return;
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query("BEGIN");
      await deleteTransaction(
        cleanupClient,
        userId,
        probeTransactionId,
        {
          reason: "Clean up the report snapshot integration probe.",
        },
        "2026-10-24",
      );
      await cleanupClient.query("COMMIT");
    } catch (error) {
      await cleanupClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      cleanupClient.release();
    }
  };
  try {
    const report = await withReadOnlyRepeatableReadTransaction(
      pool,
      async (client) => {
        const wrappedClient = new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return async (queryText: string, values?: unknown[]) => {
                const result = await target.query(queryText, values as never[]);
                if (
                  !injectedPosting &&
                  queryText.includes('AS "incomeMinor"')
                ) {
                  injectedPosting = true;
                  const writer = await pool.connect();
                  try {
                    await writer.query("BEGIN");
                    const probe = await createIncomeOrExpense(
                      writer,
                      userId,
                      {
                        kind: "EXPENSE",
                        sourceAccountId: accountId,
                        categoryId: foodCategoryId,
                        amountMinor: "1200",
                        occurredOn: "1901-06-15",
                        note: probeNote,
                      },
                      "2026-10-22",
                    );
                    probeTransactionId = probe.transaction.id;
                    await writer.query("COMMIT");
                  } catch (error) {
                    await writer.query("ROLLBACK");
                    throw error;
                  } finally {
                    writer.release();
                  }
                }
                return result;
              };
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as PoolClient;

        return readMonthlyReport(wrappedClient, userId, "1901-06");
      },
    );

    assert.equal(injectedPosting, true);
    assert.equal(report.netExpensesMinor, "0");
    assert.deepEqual(report.categories, []);

    const refreshed = await withReadOnlyRepeatableReadTransaction(
      pool,
      (client) => readMonthlyReport(client, userId, "1901-06"),
    );
    assert.equal(refreshed.netExpensesMinor, "1200");
    assert.equal(refreshed.categories[0]?.categoryId, foodCategoryId);
    assert.equal(refreshed.categories[0]?.amountMinor, "1200");
  } catch (error) {
    await cleanupProbe().catch((cleanupError: unknown) => {
      console.error(
        "Failed to clean up the report snapshot probe.",
        cleanupError,
      );
    });
    throw error;
  }
  await cleanupProbe();
});
