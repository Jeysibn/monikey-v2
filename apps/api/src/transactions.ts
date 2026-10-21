import type { PoolClient } from "pg";
import { moneyMinor } from "@monikey/money";
import type {
  TransactionCreateRequest,
  TransactionKindSchema,
} from "@monikey/contracts";
import {
  readFinancialAccount,
  type FinancialAccountRecord,
} from "./accounts.js";
import { postBalancedJournal } from "./ledger/service.js";

type TransactionKind = (typeof TransactionKindSchema)["_output"];

export type TransactionRecord = {
  id: string;
  kind: TransactionKind;
  status: "POSTED" | "VOID";
  currentRevision: number;
  occurredOn: string;
  categoryId: string;
  note: string | null;
};

export type TransactionCreateResult = {
  transaction: TransactionRecord;
  account: FinancialAccountRecord;
};

export class TransactionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super("The requested transaction resource was not found.");
    this.name = "TransactionNotFoundError";
  }
}

export class TransactionConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "TransactionConflictError";
  }
}

export class TransactionValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "TransactionValidationError";
  }
}

function mapTransaction(row: {
  id: string;
  kind: TransactionKind;
  status: "POSTED" | "VOID";
  currentRevision: number;
  occurredOn: string;
  categoryId: string;
  note: string | null;
}): TransactionRecord {
  return row;
}

function assertOccurredOnNotFuture(occurredOn: string, serverToday: string) {
  const parsed = new Date(`${occurredOn}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== occurredOn
  ) {
    throw new TransactionValidationError("Transaction date is invalid.");
  }
  if (occurredOn > serverToday) {
    throw new TransactionValidationError(
      "A posted transaction cannot have a future date.",
    );
  }
}

async function readOwnedAccountForPosting(
  client: PoolClient,
  userId: string,
  accountId: string,
): Promise<{ type: string; archivedAt: Date | null; ledgerAccountId: string }> {
  const result = await client.query<{
    type: string;
    archivedAt: Date | null;
    ledgerAccountId: string;
  }>(
    `SELECT a.type, a.archived_at AS "archivedAt", la.id AS "ledgerAccountId"
       FROM financial_accounts a
       JOIN ledger_accounts la
         ON la.user_id = a.user_id AND la.financial_account_id = a.id
      WHERE a.user_id = $1 AND a.id = $2
      FOR UPDATE OF a`,
    [userId, accountId],
  );
  const account = result.rows[0];
  if (!account) throw new TransactionNotFoundError();
  return account;
}

async function readOwnedCategoryForPosting(
  client: PoolClient,
  userId: string,
  categoryId: string,
): Promise<{
  kind: TransactionKind;
  archivedAt: Date | null;
  ledgerAccountId: string;
}> {
  const result = await client.query<{
    kind: TransactionKind;
    archivedAt: Date | null;
    ledgerAccountId: string;
  }>(
    `SELECT c.kind, c.archived_at AS "archivedAt", la.id AS "ledgerAccountId"
       FROM categories c
       JOIN ledger_accounts la
         ON la.user_id = c.user_id AND la.category_id = c.id
      WHERE c.user_id = $1 AND c.id = $2
      FOR SHARE OF c`,
    [userId, categoryId],
  );
  const category = result.rows[0];
  if (!category) throw new TransactionNotFoundError();
  return category;
}

export async function createIncomeOrExpense(
  client: PoolClient,
  userId: string,
  request: TransactionCreateRequest,
  serverToday: string,
): Promise<TransactionCreateResult> {
  assertOccurredOnNotFuture(request.occurredOn, serverToday);
  const amount = moneyMinor(request.amountMinor);
  const account = await readOwnedAccountForPosting(
    client,
    userId,
    request.sourceAccountId,
  );
  if (account.archivedAt) throw new TransactionNotFoundError();
  if (account.type === "CREDIT_CARD") {
    throw new TransactionConflictError(
      "Credit card purchases are not available in this command yet.",
    );
  }

  const category = await readOwnedCategoryForPosting(
    client,
    userId,
    request.categoryId,
  );
  if (category.archivedAt) throw new TransactionNotFoundError();
  if (category.kind !== request.kind) {
    throw new TransactionConflictError(
      "The category kind does not match the transaction kind.",
    );
  }

  const currentAccount = await readFinancialAccount(
    client,
    userId,
    request.sourceAccountId,
  );
  const currentBalance = BigInt(currentAccount.balanceMinor);
  if (
    request.kind === "EXPENSE" &&
    currentBalance < amount &&
    request.acknowledgeNegativeBalance !== true
  ) {
    throw new TransactionConflictError(
      `This expense would make ${currentAccount.name} negative. Confirm the negative balance to continue.`,
    );
  }

  const transactionResult = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note)
     VALUES ($1, $2, $3::date, $4, $5)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId", note`,
    [
      userId,
      request.kind,
      request.occurredOn,
      request.categoryId,
      request.note ?? null,
    ],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction)
    throw new TransactionValidationError("Unable to create transaction.");

  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id)
     VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: request.kind,
        sourceAccountId: request.sourceAccountId,
        categoryId: request.categoryId,
        amountMinor: request.amountMinor,
        occurredOn: request.occurredOn,
        note: request.note ?? null,
      }),
    ],
  );

  const accountPosting = {
    ledgerAccountId: account.ledgerAccountId,
    direction: request.kind === "EXPENSE" ? "CREDIT" : "DEBIT",
    amountMinor: amount,
  } as const;
  const categoryPosting = {
    ledgerAccountId: category.ledgerAccountId,
    direction: request.kind === "EXPENSE" ? "DEBIT" : "CREDIT",
    amountMinor: amount,
  } as const;
  await postBalancedJournal(client, {
    userId,
    transactionId: transaction.id,
    operationKind: request.kind,
    postings: [accountPosting, categoryPosting],
  });

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'POSTED', $3::jsonb)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: request.kind,
        categoryId: request.categoryId,
        accountId: request.sourceAccountId,
        amountMinor: request.amountMinor,
      }),
    ],
  );

  return {
    transaction: mapTransaction(transaction),
    account: await readFinancialAccount(
      client,
      userId,
      request.sourceAccountId,
    ),
  };
}
