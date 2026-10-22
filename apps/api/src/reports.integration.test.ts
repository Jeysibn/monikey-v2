import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount } from "./accounts.js";
import {
  csvCell,
  listExportTransactions,
  readMonthlyReport,
  transactionsCsv,
} from "./reports.js";
import { createIncomeOrExpense, createRefund } from "./transactions.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";

const pool = new Pool({ connectionString: requireDatabaseUrl() });
after(async () => pool.end());

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
        amountMinor: "20000",
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
        amountMinor: "50000",
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
        amountMinor: "5000",
        occurredOn: "2025-01-12",
      },
      "2026-10-22",
    );
    const report = await readMonthlyReport(client, userId, "2025-01");
    assert.equal(report.incomeMinor, "50000");
    assert.equal(report.netExpensesMinor, "15000");
    assert.equal(report.netCashFlowMinor, "35000");
    assert.equal(
      report.categories.find((row) => row.categoryId === food.id)?.amountMinor,
      "15000",
    );

    const exported = await listExportTransactions(
      client,
      userId,
      "2025-01-01",
      "2025-01-31",
    );
    assert.ok(exported.some((row) => row.id === expense.transaction.id));
    const csv = transactionsCsv([
      { ...exported[0]!, note: "=unsafe", currentRevision: 1 },
    ]);
    assert.match(csv, /'=unsafe/);
    assert.equal(csvCell(" \t=unsafe"), '"\' \t=unsafe"');
    assert.equal(csvCell("-500", false), '"-500"');
    assert.match(csv, /\r\n$/);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
