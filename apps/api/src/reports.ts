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
           COALESCE(
             t.category_id::text,
             CASE WHEN j.operation_kind = 'TRANSFER'
                  THEN r.after_json ->> 'feeCategoryId' END
           ) AS "categoryId"
      FROM journals j
      JOIN transactions t ON t.user_id = j.user_id AND t.id = j.transaction_id
      LEFT JOIN transaction_revisions r
        ON r.user_id = t.user_id
       AND r.transaction_id = t.id
       AND r.version = t.current_revision
     WHERE j.user_id = $1
       AND j.occurred_on >= $2::date
       AND j.occurred_on < $3::date
       AND j.operation_kind IN ('INCOME', 'EXPENSE', 'REFUND', 'TRANSFER')
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
       LEFT JOIN categories c
         ON c.user_id = $1 AND c.id::text = aj."categoryId"
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

const exportTransactionQuery = `SELECT t.id, t.kind, t.status, t.occurred_on::text AS "occurredOn",
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
   AND ($3::date IS NULL OR t.occurred_on <= $3::date)`;

export async function* streamExportTransactionPages(
  client: PoolClient,
  userId: string,
  from?: string,
  to?: string,
  pageSize = 500,
): AsyncGenerator<ExportTransaction[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000) {
    throw new RangeError("Export page size must be between 1 and 5000.");
  }

  let after: { occurredOn: string; id: string } | undefined;
  while (true) {
    const result = await client.query<ExportTransaction>(
      `${exportTransactionQuery}
          AND ($4::date IS NULL OR (t.occurred_on, t.id) > ($4::date, $5::uuid))
        ORDER BY t.occurred_on, t.id
        LIMIT $6::integer`,
      [
        userId,
        from ?? null,
        to ?? null,
        after?.occurredOn ?? null,
        after?.id ?? null,
        pageSize,
      ],
    );

    if (result.rows.length === 0) return;
    yield result.rows;
    const last = result.rows[result.rows.length - 1]!;
    after = { occurredOn: last.occurredOn, id: last.id };
  }
}

export function csvCell(
  value: string | number | null,
  formulaSafe = true,
): string {
  const raw = value === null ? "" : String(value);
  // Control characters are intentionally included to protect spreadsheet exports.
  /* eslint-disable no-control-regex */
  const safe =
    formulaSafe && /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(raw)
      ? `'${raw}`
      : raw;
  /* eslint-enable no-control-regex */
  return `"${safe.replaceAll('"', '""')}"`;
}

export function transactionsCsv(rows: ExportTransaction[]): string {
  const header = csvHeader();
  const values = rows.map(csvTransactionRow);
  return [header, ...values, ""].join("\r\n");
}

const csvHeaders = [
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

function csvHeader(): string {
  return csvHeaders.map((header) => csvCell(header)).join(",");
}

function csvTransactionRow(row: ExportTransaction): string {
  return [
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
    .join(",");
}

export async function* streamTransactionsCsv(
  client: PoolClient,
  userId: string,
  from?: string,
  to?: string,
  pageSize = 500,
): AsyncGenerator<string> {
  yield `${csvHeader()}\r\n`;
  for await (const page of streamExportTransactionPages(
    client,
    userId,
    from,
    to,
    pageSize,
  )) {
    yield `${page.map(csvTransactionRow).join("\r\n")}\r\n`;
  }
}

export async function* streamTransactionsJsonArray(
  client: PoolClient,
  userId: string,
  from?: string,
  to?: string,
  pageSize = 500,
): AsyncGenerator<string> {
  let first = true;
  for await (const page of streamExportTransactionPages(
    client,
    userId,
    from,
    to,
    pageSize,
  )) {
    for (const transaction of page) {
      yield `${first ? "" : ","}${JSON.stringify(transaction)}`;
      first = false;
    }
  }
}
