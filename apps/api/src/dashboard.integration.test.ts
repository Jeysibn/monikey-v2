import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { createFinancialAccount } from "./accounts.js";
import { readDashboardSummary } from "./dashboard.js";
import { requireDatabaseUrl } from "./test-support/database-url.js";
import {
  createIncomeOrExpense,
  createTransfer,
  editIncomeOrExpense,
} from "./transactions.js";

const databaseUrl = requireDatabaseUrl();
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test("dashboard summary reconciles balances, spending, transfers, and edits", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email_normalized = 'second@example.test'`,
    );
    assert.ok(owner.rows[0]?.id);
    const userId = owner.rows[0]!.id;

    const bank = await createFinancialAccount(
      client,
      userId,
      { type: "BANK", name: "Dashboard bank", openingBalanceMinor: "100000" },
      "2026-10-22",
    );
    const wallet = await createFinancialAccount(
      client,
      userId,
      {
        type: "EWALLET",
        name: "Dashboard wallet",
        openingBalanceMinor: "50000",
      },
      "2026-10-22",
    );
    const card = await createFinancialAccount(
      client,
      userId,
      {
        type: "CREDIT_CARD",
        name: "Dashboard card",
        openingBalanceMinor: "20000",
        creditLimitMinor: "100000",
      },
      "2026-10-22",
    );
    assert.equal(card.balanceMinor, "20000");

    const categories = await client.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM categories
        WHERE user_id = $1 AND name IN ('Food', 'Salary')`,
      [userId],
    );
    const expenseCategory = categories.rows.find(
      (row) => row.kind === "EXPENSE",
    );
    const incomeCategory = categories.rows.find((row) => row.kind === "INCOME");
    assert.ok(expenseCategory?.id);
    assert.ok(incomeCategory?.id);

    const expense = await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "EXPENSE",
        sourceAccountId: bank.id,
        categoryId: expenseCategory.id,
        amountMinor: "25000",
        occurredOn: "2026-10-22",
        note: "Original lunch",
      },
      "2026-10-22",
    );
    await createIncomeOrExpense(
      client,
      userId,
      {
        kind: "INCOME",
        sourceAccountId: bank.id,
        categoryId: incomeCategory.id,
        amountMinor: "40000",
        occurredOn: "2026-10-22",
        note: "Payday",
      },
      "2026-10-22",
    );
    await createTransfer(
      client,
      userId,
      {
        kind: "TRANSFER",
        fromAccountId: bank.id,
        toAccountId: wallet.id,
        amountMinor: "10000",
        feeMinor: "1500",
        feeCategoryId: expenseCategory.id,
        occurredOn: "2026-10-22",
        note: "Move to wallet",
      },
      "2026-10-22",
    );
    await editIncomeOrExpense(
      client,
      userId,
      expense.transaction.id,
      {
        kind: "EXPENSE",
        sourceAccountId: bank.id,
        categoryId: expenseCategory.id,
        amountMinor: "20000",
        occurredOn: "2026-10-22",
        note: "Edited lunch",
        reason: "Corrected receipt amount",
      },
      "2026-10-22",
    );

    const summary = await readDashboardSummary(client, userId, "2026-10-22");
    assert.deepEqual(
      {
        availableMoneyMinor: summary.availableMoneyMinor,
        cardDebtMinor: summary.cardDebtMinor,
        netFinancialPositionMinor: summary.netFinancialPositionMinor,
        month: summary.month,
        incomeMinor: summary.incomeMinor,
        spendingMinor: summary.spendingMinor,
      },
      {
        availableMoneyMinor: "168500",
        cardDebtMinor: "20000",
        netFinancialPositionMinor: "148500",
        month: "2026-10",
        incomeMinor: "40000",
        spendingMinor: "21500",
      },
    );
    assert.deepEqual(
      summary.accounts.map((account) => [account.name, account.balanceMinor]),
      [
        ["Dashboard bank", "108500"],
        ["Dashboard card", "20000"],
        ["Dashboard wallet", "60000"],
      ],
    );
    assert.ok(summary.recentActivity.length > 0);
    assert.ok(summary.recentActivity.length <= 5);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
