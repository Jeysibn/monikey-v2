import type { PoolClient } from "pg";
import type {
  BillCreateRequest,
  BillOccurrenceRecord,
  BillPatchRequest,
} from "@monikey/contracts";
import { FinancialDateSchema } from "@monikey/contracts";
import { moneyMinor } from "@monikey/money";
import {
  createIncomeOrExpense,
  type TransactionCreateResult,
} from "./transactions.js";

export type BillRecord = {
  id: string;
  name: string;
  categoryId: string;
  suggestedAccountId: string | null;
  amountMode: "FIXED" | "VARIABLE";
  defaultAmountMinor: string | null;
  dueDay: number;
  startOn: string;
  endOn: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillOccurrenceWithBill = BillOccurrenceRecord;

export class BillNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("The requested bill resource was not found.");
    this.name = "BillNotFoundError";
  }
}

export class BillConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "BillConflictError";
  }
}

export class BillValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "BillValidationError";
  }
}

type BillRow = Omit<BillRecord, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

function mapBill(row: BillRow): BillRecord {
  return {
    ...row,
    defaultAmountMinor:
      row.defaultAmountMinor === null
        ? null
        : moneyMinor(row.defaultAmountMinor).toString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function readBillRow(
  client: PoolClient,
  userId: string,
  billId: string,
  lock = false,
): Promise<BillRecord> {
  if (lock) {
    const locked = await client.query(
      `SELECT id FROM bills WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [userId, billId],
    );
    if (locked.rowCount === 0) throw new BillNotFoundError();
  }
  const result = await client.query<BillRow>(
    `SELECT id, name, category_id AS "categoryId",
            suggested_account_id AS "suggestedAccountId",
            amount_mode AS "amountMode",
            default_amount_minor::text AS "defaultAmountMinor",
            due_day AS "dueDay", start_on::text AS "startOn",
            end_on::text AS "endOn", status, note,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM bills
      WHERE user_id = $1 AND id = $2`,
    [userId, billId],
  );
  const bill = result.rows[0];
  if (!bill) throw new BillNotFoundError();
  return mapBill(bill);
}

async function assertCategory(
  client: PoolClient,
  userId: string,
  categoryId: string,
) {
  const result = await client.query<{ kind: string; archivedAt: Date | null }>(
    `SELECT kind, archived_at AS "archivedAt"
       FROM categories WHERE user_id = $1 AND id = $2`,
    [userId, categoryId],
  );
  const category = result.rows[0];
  if (!category || category.kind !== "EXPENSE" || category.archivedAt) {
    throw new BillNotFoundError();
  }
}

async function assertSuggestedAccount(
  client: PoolClient,
  userId: string,
  accountId: string | null | undefined,
) {
  if (!accountId) return;
  const result = await client.query<{ type: string; archivedAt: Date | null }>(
    `SELECT type, archived_at AS "archivedAt"
       FROM financial_accounts WHERE user_id = $1 AND id = $2`,
    [userId, accountId],
  );
  const account = result.rows[0];
  if (
    !account ||
    account.archivedAt ||
    !["CASH", "BANK", "EWALLET"].includes(account.type)
  ) {
    throw new BillNotFoundError();
  }
}

export async function listBills(
  client: PoolClient,
  userId: string,
  includeArchived = false,
): Promise<BillRecord[]> {
  const result = await client.query<BillRow>(
    `SELECT id, name, category_id AS "categoryId",
            suggested_account_id AS "suggestedAccountId",
            amount_mode AS "amountMode",
            default_amount_minor::text AS "defaultAmountMinor",
            due_day AS "dueDay", start_on::text AS "startOn",
            end_on::text AS "endOn", status, note,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM bills
      WHERE user_id = $1 AND ($2::boolean OR status <> 'ARCHIVED')
      ORDER BY status, due_day, name, id`,
    [userId, includeArchived],
  );
  return result.rows.map(mapBill);
}

export async function createBill(
  client: PoolClient,
  userId: string,
  request: BillCreateRequest,
): Promise<BillRecord> {
  await assertCategory(client, userId, request.categoryId);
  await assertSuggestedAccount(client, userId, request.suggestedAccountId);
  const result = await client.query<{ id: string }>(
    `INSERT INTO bills
       (user_id, name, category_id, suggested_account_id, amount_mode,
        default_amount_minor, due_day, start_on, end_on, note)
     VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::date, $9::date, $10)
     RETURNING id`,
    [
      userId,
      request.name,
      request.categoryId,
      request.suggestedAccountId ?? null,
      request.amountMode,
      request.defaultAmountMinor ?? null,
      request.dueDay,
      request.startOn,
      request.endOn ?? null,
      request.note ?? null,
    ],
  );
  const bill = result.rows[0];
  if (!bill) throw new BillConflictError("The bill could not be created.");
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'BILL', $2, 'CREATED', $3::jsonb)`,
    [userId, bill.id, JSON.stringify({ amountMode: request.amountMode })],
  );
  return readBillRow(client, userId, bill.id);
}

export async function updateBill(
  client: PoolClient,
  userId: string,
  billId: string,
  patch: BillPatchRequest,
  effectiveDate: string,
): Promise<BillRecord> {
  const current = await readBillRow(client, userId, billId, true);
  if (patch.categoryId !== undefined)
    await assertCategory(client, userId, patch.categoryId);
  await assertSuggestedAccount(client, userId, patch.suggestedAccountId);
  const amountMode = patch.amountMode ?? current.amountMode;
  const defaultAmount =
    patch.defaultAmountMinor === undefined
      ? current.defaultAmountMinor
      : patch.defaultAmountMinor;
  if (amountMode === "FIXED" && defaultAmount === null) {
    throw new BillConflictError("Fixed bills require a default amount.");
  }
  if (amountMode === "VARIABLE" && defaultAmount !== null) {
    throw new BillConflictError("Variable bills cannot have a default amount.");
  }
  const startOn = patch.startOn ?? current.startOn;
  const endOn = patch.endOn === undefined ? current.endOn : patch.endOn;
  if (endOn && startOn > endOn) {
    throw new BillConflictError(
      "The bill end date must be on or after its start date.",
    );
  }
  await client.query(
    `UPDATE bills
        SET name = COALESCE($3, name),
            category_id = COALESCE($4, category_id),
            suggested_account_id = $5,
            amount_mode = $6,
            default_amount_minor = $7::bigint,
            due_day = COALESCE($8, due_day),
            start_on = $9::date,
            end_on = $10::date,
            status = COALESCE($11, status),
            note = $12,
            updated_at = now()
      WHERE user_id = $1 AND id = $2`,
    [
      userId,
      billId,
      patch.name ?? current.name,
      patch.categoryId ?? current.categoryId,
      patch.suggestedAccountId === undefined
        ? current.suggestedAccountId
        : patch.suggestedAccountId,
      amountMode,
      defaultAmount,
      patch.dueDay ?? current.dueDay,
      startOn,
      endOn,
      patch.status ?? current.status,
      patch.note === undefined ? current.note : patch.note,
    ],
  );
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'BILL', $2, 'UPDATED', $3::jsonb)`,
    [userId, billId, JSON.stringify({ fields: Object.keys(patch) })],
  );
  const scheduleChanged = [
    "amountMode",
    "defaultAmountMinor",
    "dueDay",
    "startOn",
    "endOn",
    "status",
  ].some((field) => Object.hasOwn(patch, field));
  if (scheduleChanged) {
    // The locked rule row serializes this cleanup against occurrence generation.
    await client.query(
      `DELETE FROM bill_occurrences
        WHERE user_id = $1 AND bill_id = $2
          AND due_on >= date_trunc('month', $3::date)::date
          AND status IN ('UPCOMING', 'OVERDUE')`,
      [userId, billId, effectiveDate],
    );
  }
  return readBillRow(client, userId, billId);
}

function monthKey(date: string): { year: number; month: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)) - 1,
  };
}

function monthDate(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const actualDay = Math.min(day, lastDay);
  return `${year.toString().padStart(4, "0")}-${(month + 1)
    .toString()
    .padStart(2, "0")}-${actualDay.toString().padStart(2, "0")}`;
}

function addMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  return month === 11
    ? { year: year + 1, month: 0 }
    : { year, month: month + 1 };
}

export async function ensureBillOccurrences(
  client: PoolClient,
  userId: string,
  from: string,
  to: string,
  serverToday: string,
) {
  assertOccurrenceWindow(from, to);
  const bills = await client.query<{
    id: string;
    dueDay: number;
    startOn: string;
    endOn: string | null;
    defaultAmountMinor: string | null;
  }>(
    `SELECT id, due_day AS "dueDay", start_on::text AS "startOn",
            end_on::text AS "endOn", default_amount_minor::text AS "defaultAmountMinor"
       FROM bills WHERE user_id = $1 AND status = 'ACTIVE'
       ORDER BY id FOR SHARE`,
    [userId],
  );
  const first = monthKey(from);
  const last = monthKey(to);
  for (const bill of bills.rows) {
    let cursor = first;
    while (
      cursor.year < last.year ||
      (cursor.year === last.year && cursor.month <= last.month)
    ) {
      const dueOn = monthDate(cursor.year, cursor.month, bill.dueDay);
      if (dueOn >= bill.startOn && (!bill.endOn || dueOn <= bill.endOn)) {
        await client.query(
          `INSERT INTO bill_occurrences
             (user_id, bill_id, due_on, expected_amount_minor)
           SELECT $1, $2, $3::date, $4::bigint
            WHERE NOT EXISTS (
              SELECT 1 FROM bill_occurrences terminal
               WHERE terminal.user_id = $1 AND terminal.bill_id = $2
                 AND terminal.due_on >= date_trunc('month', $3::date)::date
                 AND terminal.due_on < (date_trunc('month', $3::date) + interval '1 month')::date
                 AND terminal.status IN ('PAID', 'SKIPPED')
            )
           ON CONFLICT (user_id, bill_id, due_on) DO NOTHING`,
          [userId, bill.id, dueOn, bill.defaultAmountMinor],
        );
      }
      cursor = addMonth(cursor.year, cursor.month);
    }
  }
  await client.query(
    `UPDATE bill_occurrences
        SET status = 'OVERDUE', updated_at = now()
      WHERE user_id = $1 AND status = 'UPCOMING' AND due_on < $2::date`,
    [userId, serverToday],
  );
}

const maximumOccurrenceWindowDays = 366;

export function assertOccurrenceWindow(from: string, to: string): void {
  if (
    !FinancialDateSchema.safeParse(from).success ||
    !FinancialDateSchema.safeParse(to).success
  ) {
    throw new BillValidationError(
      "Occurrence dates must be valid calendar dates.",
    );
  }
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    fromTime > toTime ||
    (toTime - fromTime) / 86_400_000 > maximumOccurrenceWindowDays
  ) {
    throw new BillValidationError(
      "Occurrence windows must be ordered and no wider than 366 days.",
    );
  }
}

export async function listBillOccurrences(
  client: PoolClient,
  userId: string,
  from: string,
  to: string,
  serverToday: string,
): Promise<BillOccurrenceWithBill[]> {
  assertOccurrenceWindow(from, to);
  await ensureBillOccurrences(client, userId, from, to, serverToday);
  const result = await client.query<BillOccurrenceWithBill>(
    `SELECT o.id, o.bill_id AS "billId", b.name AS "billName",
            b.category_id AS "categoryId", b.suggested_account_id AS "suggestedAccountId",
            b.amount_mode AS "amountMode",
            o.expected_amount_minor::text AS "expectedAmountMinor",
            o.actual_amount_minor::text AS "actualAmountMinor",
            o.due_on::text AS "dueOn", o.status,
            o.paid_transaction_id AS "paidTransactionId", o.note
       FROM bill_occurrences o
       JOIN bills b ON b.user_id = o.user_id AND b.id = o.bill_id
      WHERE o.user_id = $1 AND o.due_on BETWEEN $2::date AND $3::date
      ORDER BY o.due_on, b.name, o.id`,
    [userId, from, to],
  );
  return result.rows;
}

export async function payBillOccurrence(
  client: PoolClient,
  userId: string,
  occurrenceId: string,
  fundingAccountId: string,
  amountMinor: string | undefined,
  note: string | undefined,
  acknowledgeNegativeBalance: boolean | undefined,
  serverToday: string,
): Promise<{
  occurrence: BillOccurrenceWithBill;
  transaction: TransactionCreateResult["transaction"];
}> {
  const occurrenceResult = await client.query<BillOccurrenceWithBill>(
    `SELECT o.id, o.bill_id AS "billId", b.name AS "billName",
            b.category_id AS "categoryId", b.suggested_account_id AS "suggestedAccountId",
            b.amount_mode AS "amountMode",
            o.expected_amount_minor::text AS "expectedAmountMinor",
            o.actual_amount_minor::text AS "actualAmountMinor",
            o.due_on::text AS "dueOn", o.status,
            o.paid_transaction_id AS "paidTransactionId", o.note
       FROM bill_occurrences o
       JOIN bills b ON b.user_id = o.user_id AND b.id = o.bill_id
      WHERE o.user_id = $1 AND o.id = $2
      FOR UPDATE OF o`,
    [userId, occurrenceId],
  );
  const occurrence = occurrenceResult.rows[0];
  if (!occurrence) throw new BillNotFoundError();
  if (occurrence.status === "PAID") {
    throw new BillConflictError("This bill occurrence has already been paid.");
  }
  if (occurrence.status === "SKIPPED") {
    throw new BillConflictError("A skipped bill occurrence cannot be paid.");
  }
  const effectiveAmount =
    amountMinor ?? occurrence.expectedAmountMinor ?? undefined;
  if (!effectiveAmount) {
    throw new BillConflictError(
      "Variable bills require an actual amount before payment.",
    );
  }
  const amount = moneyMinor(effectiveAmount);
  if (amount <= 0n)
    throw new BillConflictError("The bill amount must be positive.");
  const transaction = await createIncomeOrExpense(
    client,
    userId,
    {
      kind: "EXPENSE",
      sourceAccountId: fundingAccountId,
      categoryId: occurrence.categoryId,
      amountMinor: amount.toString(),
      occurredOn: serverToday,
      ...(note ? { note } : {}),
      ...(acknowledgeNegativeBalance
        ? { acknowledgeNegativeBalance: true }
        : {}),
    },
    serverToday,
  );
  await client.query(
    `UPDATE bill_occurrences
        SET actual_amount_minor = $3::bigint,
            status = 'PAID',
            paid_transaction_id = $4,
            paid_at = now(),
            updated_at = now()
      WHERE user_id = $1 AND id = $2`,
    [userId, occurrenceId, amount.toString(), transaction.transaction.id],
  );
  await client.query(
    `INSERT INTO bill_occurrence_payment_history
       (user_id, occurrence_id, transaction_id, sequence_number, action, amount_minor)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(sequence_number), 0) + 1
                FROM bill_occurrence_payment_history
               WHERE user_id = $1 AND occurrence_id = $2),
             'POSTED', $4::bigint)`,
    [userId, occurrenceId, transaction.transaction.id, amount.toString()],
  );
  const updated = await client.query<BillOccurrenceWithBill>(
    `SELECT o.id, o.bill_id AS "billId", b.name AS "billName",
            b.category_id AS "categoryId", b.suggested_account_id AS "suggestedAccountId",
            b.amount_mode AS "amountMode",
            o.expected_amount_minor::text AS "expectedAmountMinor",
            o.actual_amount_minor::text AS "actualAmountMinor",
            o.due_on::text AS "dueOn", o.status,
            o.paid_transaction_id AS "paidTransactionId", o.note
       FROM bill_occurrences o
       JOIN bills b ON b.user_id = o.user_id AND b.id = o.bill_id
      WHERE o.user_id = $1 AND o.id = $2`,
    [userId, occurrenceId],
  );
  return { occurrence: updated.rows[0]!, transaction: transaction.transaction };
}

export async function skipBillOccurrence(
  client: PoolClient,
  userId: string,
  occurrenceId: string,
): Promise<BillOccurrenceWithBill> {
  const updated = await client.query<BillOccurrenceWithBill>(
    `UPDATE bill_occurrences o
        SET status = 'SKIPPED', updated_at = now()
      WHERE o.user_id = $1 AND o.id = $2 AND o.status IN ('UPCOMING', 'OVERDUE')
      RETURNING o.id, o.bill_id AS "billId",
                (SELECT name FROM bills b WHERE b.user_id = o.user_id AND b.id = o.bill_id) AS "billName",
                (SELECT category_id FROM bills b WHERE b.user_id = o.user_id AND b.id = o.bill_id) AS "categoryId",
                (SELECT suggested_account_id FROM bills b WHERE b.user_id = o.user_id AND b.id = o.bill_id) AS "suggestedAccountId",
                (SELECT amount_mode FROM bills b WHERE b.user_id = o.user_id AND b.id = o.bill_id) AS "amountMode",
                o.expected_amount_minor::text AS "expectedAmountMinor",
                o.actual_amount_minor::text AS "actualAmountMinor",
                o.due_on::text AS "dueOn", o.status,
                o.paid_transaction_id AS "paidTransactionId", o.note`,
    [userId, occurrenceId],
  );
  const occurrence = updated.rows[0];
  if (!occurrence) throw new BillNotFoundError();
  return occurrence;
}
