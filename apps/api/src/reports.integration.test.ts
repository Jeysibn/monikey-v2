import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { createFinancialAccount } from "./accounts.js";
import {
  csvCell,
  readMonthlyReport,
  type ExportTransaction,
  streamExportTransactionPages,
  streamTransactionsCsv,
  streamTransactionsJsonArray,
  transactionsCsv,
} from "./reports.js";
import { createIncomeOrExpense, createRefund } from "./transactions.js";
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
