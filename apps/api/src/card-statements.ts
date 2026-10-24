import type { PoolClient } from "pg";
import type {
  CardStatementCreateRequest,
  CardStatementPatchRequest,
} from "@monikey/contracts";
import { moneyMinor } from "@monikey/money";

export type CardStatementRecord = {
  id: string;
  cardAccountId: string;
  statementDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  amountDueMinor: string;
  allocatedMinor: string;
  remainingDueMinor: string;
  paymentDueDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type StatementRow = Omit<
  CardStatementRecord,
  "allocatedMinor" | "remainingDueMinor"
> & {
  allocatedMinor: string;
};

export class CardStatementNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("The requested card statement was not found.");
    this.name = "CardStatementNotFoundError";
  }
}

export class CardStatementConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "CardStatementConflictError";
  }
}

const statementSelect = `
  SELECT s.id,
         s.card_account_id AS "cardAccountId",
         s.statement_date::text AS "statementDate",
         s.period_start::text AS "periodStart",
         s.period_end::text AS "periodEnd",
         s.amount_due_minor::text AS "amountDueMinor",
         COALESCE(SUM(a.amount_minor), 0)::text AS "allocatedMinor",
         s.payment_due_date::text AS "paymentDueDate",
         s.note,
         s.created_at AS "createdAt",
         s.updated_at AS "updatedAt"
    FROM card_statements s
    LEFT JOIN card_statement_allocations a
      ON a.user_id = s.user_id AND a.statement_id = s.id
     AND a.reversed_at IS NULL`;

function mapStatement(row: StatementRow): CardStatementRecord {
  const amount = moneyMinor(row.amountDueMinor);
  const allocated = moneyMinor(row.allocatedMinor);
  const remaining = amount > allocated ? amount - allocated : 0n;
  return {
    ...row,
    amountDueMinor: amount.toString(),
    allocatedMinor: allocated.toString(),
    remainingDueMinor: remaining.toString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function assertCardAccount(
  client: PoolClient,
  userId: string,
  cardAccountId: string,
  allowArchived = false,
) {
  const result = await client.query<{ type: string; archivedAt: Date | null }>(
    `SELECT type, archived_at AS "archivedAt"
       FROM financial_accounts
      WHERE user_id = $1 AND id = $2`,
    [userId, cardAccountId],
  );
  const account = result.rows[0];
  if (!account || account.type !== "CREDIT_CARD") {
    throw new CardStatementNotFoundError();
  }
  if (account.archivedAt && !allowArchived) {
    throw new CardStatementConflictError(
      "Archived cards cannot receive new statements.",
    );
  }
}

export async function listCardStatements(
  client: PoolClient,
  userId: string,
  cardAccountId: string,
  allowArchived = false,
): Promise<CardStatementRecord[]> {
  await assertCardAccount(client, userId, cardAccountId, allowArchived);
  const result = await client.query<StatementRow>(
    `${statementSelect}
      WHERE s.user_id = $1 AND s.card_account_id = $2
      GROUP BY s.id
      ORDER BY s.statement_date DESC, s.id DESC`,
    [userId, cardAccountId],
  );
  return result.rows.map(mapStatement);
}

export async function readCardStatement(
  client: PoolClient,
  userId: string,
  cardAccountId: string,
  statementId: string,
  lock = false,
): Promise<CardStatementRecord> {
  await assertCardAccount(client, userId, cardAccountId);
  if (lock) {
    const locked = await client.query(
      `SELECT id FROM card_statements
        WHERE user_id = $1 AND card_account_id = $2 AND id = $3
        FOR UPDATE`,
      [userId, cardAccountId, statementId],
    );
    if (locked.rowCount === 0) throw new CardStatementNotFoundError();
  }
  const result = await client.query<StatementRow>(
    `${statementSelect}
      WHERE s.user_id = $1 AND s.card_account_id = $2 AND s.id = $3
      GROUP BY s.id`,
    [userId, cardAccountId, statementId],
  );
  const statement = result.rows[0];
  if (!statement) throw new CardStatementNotFoundError();
  return mapStatement(statement);
}

export async function createCardStatement(
  client: PoolClient,
  userId: string,
  cardAccountId: string,
  request: CardStatementCreateRequest,
): Promise<CardStatementRecord> {
  await assertCardAccount(client, userId, cardAccountId);
  const result = await client.query<{ id: string }>(
    `INSERT INTO card_statements
       (user_id, card_account_id, statement_date, period_start, period_end,
        amount_due_minor, payment_due_date, note)
     VALUES ($1, $2, $3::date, $4::date, $5::date, $6::bigint, $7::date, $8)
     RETURNING id`,
    [
      userId,
      cardAccountId,
      request.statementDate,
      request.periodStart ?? null,
      request.periodEnd ?? null,
      request.amountDueMinor,
      request.paymentDueDate,
      request.note ?? null,
    ],
  );
  const statement = result.rows[0];
  if (!statement)
    throw new CardStatementConflictError("The statement could not be created.");
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'CARD_STATEMENT', $2, 'CREATED', $3::jsonb)`,
    [
      userId,
      statement.id,
      JSON.stringify({ cardAccountId, amountDueMinor: request.amountDueMinor }),
    ],
  );
  return readCardStatement(client, userId, cardAccountId, statement.id);
}

export async function updateCardStatement(
  client: PoolClient,
  userId: string,
  cardAccountId: string,
  statementId: string,
  patch: CardStatementPatchRequest,
): Promise<CardStatementRecord> {
  const current = await readCardStatement(
    client,
    userId,
    cardAccountId,
    statementId,
    true,
  );
  const amountDueMinor = patch.amountDueMinor ?? current.amountDueMinor;
  if (BigInt(amountDueMinor) < BigInt(current.allocatedMinor)) {
    throw new CardStatementConflictError(
      "Statement amount due cannot be lower than payments already allocated.",
    );
  }
  const periodStart =
    patch.periodStart === undefined ? current.periodStart : patch.periodStart;
  const periodEnd =
    patch.periodEnd === undefined ? current.periodEnd : patch.periodEnd;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new CardStatementConflictError(
      "The statement period must be ordered.",
    );
  }
  await client.query(
    `UPDATE card_statements
        SET statement_date = COALESCE($4::date, statement_date),
            period_start = $5::date,
            period_end = $6::date,
            amount_due_minor = $7::bigint,
            payment_due_date = COALESCE($8::date, payment_due_date),
            note = $9,
            updated_at = now()
      WHERE user_id = $1 AND card_account_id = $2 AND id = $3`,
    [
      userId,
      cardAccountId,
      statementId,
      patch.statementDate ?? null,
      periodStart,
      periodEnd,
      amountDueMinor,
      patch.paymentDueDate ?? null,
      patch.note === undefined ? current.note : patch.note,
    ],
  );
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'CARD_STATEMENT', $2, 'UPDATED', $3::jsonb)`,
    [
      userId,
      statementId,
      JSON.stringify({ cardAccountId, fields: Object.keys(patch) }),
    ],
  );
  return readCardStatement(client, userId, cardAccountId, statementId);
}
