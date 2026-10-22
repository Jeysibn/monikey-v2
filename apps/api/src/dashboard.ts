import type { PoolClient } from "pg";
import {
  listFinancialAccounts,
  type FinancialAccountRecord,
} from "./accounts.js";
import { listTransactions } from "./transactions.js";

type DashboardTotalsRow = {
  availableMoneyMinor: string;
  cardDebtMinor: string;
};

type MonthTotalsRow = {
  incomeMinor: string;
  spendingMinor: string;
};

export type DashboardSummary = {
  availableMoneyMinor: string;
  cardDebtMinor: string;
  netFinancialPositionMinor: string;
  month: string;
  incomeMinor: string;
  spendingMinor: string;
  accounts: FinancialAccountRecord[];
  recentActivity: Awaited<ReturnType<typeof listTransactions>>["activity"];
  serverToday: string;
};

function nextMonthStart(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month!, 1));
  return next.toISOString().slice(0, 10);
}

async function readAccountTotals(
  client: PoolClient,
  userId: string,
): Promise<DashboardTotalsRow> {
  const result = await client.query<DashboardTotalsRow>(
    `WITH account_balances AS (
       SELECT a.type,
              COALESCE(
                SUM(
                  CASE
                    WHEN la.type = 'LIABILITY' AND p.direction = 'CREDIT' THEN p.amount_minor::numeric
                    WHEN la.type = 'LIABILITY' AND p.direction = 'DEBIT' THEN -p.amount_minor::numeric
                    WHEN la.type = 'ASSET' AND p.direction = 'DEBIT' THEN p.amount_minor::numeric
                    WHEN la.type = 'ASSET' AND p.direction = 'CREDIT' THEN -p.amount_minor::numeric
                    ELSE 0::numeric
                  END
                ),
                0::numeric
              ) AS balance_minor
         FROM financial_accounts a
         LEFT JOIN ledger_accounts la
           ON la.user_id = a.user_id AND la.financial_account_id = a.id
         LEFT JOIN postings p
           ON p.user_id = la.user_id AND p.ledger_account_id = la.id
        WHERE a.user_id = $1 AND a.archived_at IS NULL
        GROUP BY a.id, a.type
     )
     SELECT COALESCE(
              SUM(balance_minor) FILTER (WHERE type IN ('CASH', 'BANK', 'EWALLET')),
              0::numeric
            )::text AS "availableMoneyMinor",
            COALESCE(
              SUM(balance_minor) FILTER (WHERE type = 'CREDIT_CARD'),
              0::numeric
            )::text AS "cardDebtMinor"
       FROM account_balances`,
    [userId],
  );
  return result.rows[0] ?? { availableMoneyMinor: "0", cardDebtMinor: "0" };
}

async function readMonthTotals(
  client: PoolClient,
  userId: string,
  monthStart: string,
  nextMonth: string,
): Promise<MonthTotalsRow> {
  const result = await client.query<MonthTotalsRow>(
    `WITH active_journals AS (
       SELECT j.id
         FROM journals j
        WHERE j.user_id = $1
          AND j.occurred_on >= $2::date
          AND j.occurred_on < $3::date
          AND j.operation_kind <> 'REVERSAL'
          AND NOT EXISTS (
            SELECT 1
              FROM journals reversal
             WHERE reversal.user_id = j.user_id
               AND reversal.reversal_of = j.id
          )
     )
     SELECT COALESCE(
              SUM(
                CASE
                  WHEN la.type = 'INCOME' AND p.direction = 'CREDIT' THEN p.amount_minor::numeric
                  ELSE 0::numeric
                END
              ),
              0::numeric
            )::text AS "incomeMinor",
            COALESCE(
              SUM(
                CASE
                  WHEN la.type = 'EXPENSE' AND p.direction = 'DEBIT' THEN p.amount_minor::numeric
                  WHEN la.type = 'EXPENSE' AND p.direction = 'CREDIT' THEN -p.amount_minor::numeric
                  ELSE 0::numeric
                END
              ),
              0::numeric
            )::text AS "spendingMinor"
       FROM active_journals aj
       JOIN postings p
         ON p.user_id = $1 AND p.journal_id = aj.id
       JOIN ledger_accounts la
         ON la.user_id = p.user_id AND la.id = p.ledger_account_id`,
    [userId, monthStart, nextMonth],
  );
  return result.rows[0] ?? { incomeMinor: "0", spendingMinor: "0" };
}

export async function readDashboardSummary(
  client: PoolClient,
  userId: string,
  serverToday: string,
): Promise<DashboardSummary> {
  const month = serverToday.slice(0, 7);
  const monthStart = `${month}-01`;
  const [totals, monthTotals, accounts, recent] = await Promise.all([
    readAccountTotals(client, userId),
    readMonthTotals(client, userId, monthStart, nextMonthStart(monthStart)),
    listFinancialAccounts(client, userId),
    listTransactions(client, userId, { limit: 5 }),
  ]);
  const available = BigInt(totals.availableMoneyMinor);
  const cardDebt = BigInt(totals.cardDebtMinor);
  return {
    availableMoneyMinor: totals.availableMoneyMinor,
    cardDebtMinor: totals.cardDebtMinor,
    netFinancialPositionMinor: (available - cardDebt).toString(10),
    month,
    incomeMinor: monthTotals.incomeMinor,
    spendingMinor: monthTotals.spendingMinor,
    accounts,
    recentActivity: recent.activity,
    serverToday,
  };
}
