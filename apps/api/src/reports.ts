import type { PoolClient } from "pg";

export type MonthlyReportCategory = {
  categoryId: string | null;
  categoryName: string;
  amountMinor: string;
};

export type MonthlyReport = {
  month: string;
  incomeMinor: string;
  netExpensesMinor: string;
  netCashFlowMinor: string;
  categories: MonthlyReportCategory[];
};

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, monthNumber!, 1));
  return next.toISOString().slice(0, 10);
}

const activeJournalCte = `
  WITH active_journals AS (
    SELECT j.id, j.operation_kind AS "operationKind", j.occurred_on AS "occurredOn",
           t.category_id AS "categoryId"
      FROM journals j
      JOIN transactions t ON t.user_id = j.user_id AND t.id = j.transaction_id
     WHERE j.user_id = $1
       AND j.occurred_on >= $2::date
       AND j.occurred_on < $3::date
       AND j.operation_kind IN ('INCOME', 'EXPENSE', 'REFUND')
       AND NOT EXISTS (
         SELECT 1 FROM journals reversal
          WHERE reversal.user_id = j.user_id AND reversal.reversal_of = j.id
       )
  )`;

export async function readMonthlyReport(
  client: PoolClient,
  userId: string,
  month: string,
): Promise<MonthlyReport> {
  const monthStart = `${month}-01`;
  const end = nextMonth(monthStart);
  const totals = await client.query<{
    incomeMinor: string;
    netExpensesMinor: string;
  }>(
    `${activeJournalCte}
     SELECT COALESCE(SUM(
              CASE WHEN aj."operationKind" = 'INCOME'
                     AND la.type = 'INCOME' AND p.direction = 'CREDIT'
                   THEN p.amount_minor::numeric ELSE 0::numeric END
            ), 0)::text AS "incomeMinor",
            COALESCE(SUM(
              CASE WHEN la.type = 'EXPENSE' AND p.direction = 'DEBIT'
                   THEN p.amount_minor::numeric
                   WHEN la.type = 'EXPENSE' AND p.direction = 'CREDIT'
                   THEN -p.amount_minor::numeric
                   ELSE 0::numeric END
            ), 0)::text AS "netExpensesMinor"
       FROM active_journals aj
       JOIN postings p ON p.user_id = $1 AND p.journal_id = aj.id
       JOIN ledger_accounts la ON la.user_id = p.user_id AND la.id = p.ledger_account_id`,
    [userId, monthStart, end],
  );
  const categories = await client.query<MonthlyReportCategory>(
    `${activeJournalCte}
     SELECT aj."categoryId" AS "categoryId",
            COALESCE(c.name, 'Uncategorized') AS "categoryName",
            COALESCE(SUM(
              CASE WHEN p.direction = 'DEBIT' THEN p.amount_minor::numeric
                   WHEN p.direction = 'CREDIT' THEN -p.amount_minor::numeric
                   ELSE 0::numeric END
            ), 0)::text AS "amountMinor"
       FROM active_journals aj
       JOIN postings p ON p.user_id = $1 AND p.journal_id = aj.id
       JOIN ledger_accounts la
         ON la.user_id = p.user_id AND la.id = p.ledger_account_id
       LEFT JOIN categories c ON c.user_id = $1 AND c.id = aj."categoryId"
      WHERE la.type = 'EXPENSE'
      GROUP BY aj."categoryId", c.name
      HAVING SUM(CASE WHEN p.direction = 'DEBIT' THEN p.amount_minor::numeric
                      WHEN p.direction = 'CREDIT' THEN -p.amount_minor::numeric
                      ELSE 0::numeric END) <> 0
      ORDER BY ABS(SUM(CASE WHEN p.direction = 'DEBIT' THEN p.amount_minor::numeric
                            WHEN p.direction = 'CREDIT' THEN -p.amount_minor::numeric
                            ELSE 0::numeric END)) DESC, "categoryName"`,
    [userId, monthStart, end],
  );
  const income = totals.rows[0]?.incomeMinor ?? "0";
  const expenses = totals.rows[0]?.netExpensesMinor ?? "0";
  return {
    month,
    incomeMinor: income,
    netExpensesMinor: expenses,
    netCashFlowMinor: (BigInt(income) - BigInt(expenses)).toString(),
    categories: categories.rows,
  };
}

export type ExportTransaction = {
  id: string;
  kind: string;
  status: string;
  occurredOn: string;
  categoryId: string | null;
  accountId: string | null;
  destinationAccountId: string | null;
  amountMinor: string | null;
  note: string | null;
  currentRevision: number;
};

export async function listExportTransactions(
  client: PoolClient,
  userId: string,
  from?: string,
  to?: string,
): Promise<ExportTransaction[]> {
  const result = await client.query<ExportTransaction>(
    `SELECT t.id, t.kind, t.status, t.occurred_on::text AS "occurredOn",
            t.category_id AS "categoryId",
            COALESCE(r.after_json ->> 'sourceAccountId', r.after_json ->> 'accountId',
                     r.after_json ->> 'fundingAccountId', r.after_json ->> 'fromAccountId') AS "accountId",
            COALESCE(r.after_json ->> 'destinationAccountId', r.after_json ->> 'toAccountId',
                     r.after_json ->> 'cardAccountId') AS "destinationAccountId",
            r.after_json ->> 'amountMinor' AS "amountMinor",
            t.note, t.current_revision AS "currentRevision"
       FROM transactions t
       LEFT JOIN transaction_revisions r
         ON r.user_id = t.user_id AND r.transaction_id = t.id
        AND r.version = t.current_revision
      WHERE t.user_id = $1
        AND ($2::date IS NULL OR t.occurred_on >= $2::date)
        AND ($3::date IS NULL OR t.occurred_on <= $3::date)
      ORDER BY t.occurred_on, t.id`,
    [userId, from ?? null, to ?? null],
  );
  return result.rows;
}

export function csvCell(
  value: string | number | null,
  formulaSafe = true,
): string {
  const raw = value === null ? "" : String(value);
  // Control characters are intentionally included to protect spreadsheet exports.
  /* eslint-disable no-control-regex */
  const safe =
    formulaSafe && /^[\s\u0000-\u001f]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  /* eslint-enable no-control-regex */
  return `"${safe.replaceAll('"', '""')}"`;
}

export function transactionsCsv(rows: ExportTransaction[]): string {
  const headers = [
    "id",
    "kind",
    "status",
    "occurred_on",
    "category_id",
    "account_id",
    "destination_account_id",
    "amount_minor",
    "note",
    "current_revision",
  ];
  const values = rows.map((row) =>
    [
      row.id,
      row.kind,
      row.status,
      row.occurredOn,
      row.categoryId,
      row.accountId,
      row.destinationAccountId,
      row.amountMinor,
      row.note,
      row.currentRevision,
    ]
      .map((value, index) =>
        csvCell(value, index === 7 || index === 9 ? false : true),
      )
      .join(","),
  );
  return [
    headers.map((header) => csvCell(header)).join(","),
    ...values,
    "",
  ].join("\r\n");
}
