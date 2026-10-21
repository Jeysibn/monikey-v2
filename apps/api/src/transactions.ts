import type { PoolClient } from "pg";
import { moneyMinor } from "@monikey/money";
import type {
  TransactionCreateRequest,
  TransactionKindSchema,
  TransferCreateRequest,
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
  categoryId: string | null;
  note: string | null;
};

export type TransactionCreateResult = {
  transaction: TransactionRecord;
  account: FinancialAccountRecord;
};

export type TransferCreateResult = {
  transaction: TransactionRecord;
  sourceAccount: FinancialAccountRecord;
  destinationAccount: FinancialAccountRecord;
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
  categoryId: string | null;
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

export async function createTransfer(
  client: PoolClient,
  userId: string,
  request: TransferCreateRequest,
  serverToday: string,
): Promise<TransferCreateResult> {
  assertOccurredOnNotFuture(request.occurredOn, serverToday);
  if (request.fromAccountId === request.toAccountId) {
    throw new TransactionConflictError(
      "A transfer must use two different accounts.",
    );
  }

  const amount = moneyMinor(request.amountMinor);
  const fee = moneyMinor(request.feeMinor ?? "0");
  if (fee > 0n && !request.feeCategoryId) {
    throw new TransactionValidationError(
      "A fee category is required when a transfer fee is positive.",
    );
  }
  if (fee === 0n && request.feeCategoryId) {
    throw new TransactionValidationError(
      "A fee category requires a positive transfer fee.",
    );
  }
  const accountIds = [request.fromAccountId, request.toAccountId].sort();
  const lockedAccounts = new Map<
    string,
    Awaited<ReturnType<typeof readOwnedAccountForPosting>>
  >();
  for (const accountId of accountIds) {
    lockedAccounts.set(
      accountId,
      await readOwnedAccountForPosting(client, userId, accountId),
    );
  }
  const source = lockedAccounts.get(request.fromAccountId)!;
  const destination = lockedAccounts.get(request.toAccountId)!;
  if (source.archivedAt || destination.archivedAt) {
    throw new TransactionNotFoundError();
  }
  if (source.type === "CREDIT_CARD" || destination.type === "CREDIT_CARD") {
    throw new TransactionConflictError(
      "Transfers are only available between cash, bank, and e-wallet accounts.",
    );
  }

  let feeCategory:
    | Awaited<ReturnType<typeof readOwnedCategoryForPosting>>
    | undefined;
  if (fee > 0n) {
    feeCategory = await readOwnedCategoryForPosting(
      client,
      userId,
      request.feeCategoryId!,
    );
    if (feeCategory.archivedAt) throw new TransactionNotFoundError();
    if (feeCategory.kind !== "EXPENSE") {
      throw new TransactionConflictError(
        "A transfer fee must use an expense category.",
      );
    }
  }

  const currentSource = await readFinancialAccount(
    client,
    userId,
    request.fromAccountId,
  );
  const projectedSourceBalance =
    BigInt(currentSource.balanceMinor) - amount - fee;
  if (
    projectedSourceBalance < 0n &&
    request.acknowledgeNegativeBalance !== true
  ) {
    throw new TransactionConflictError(
      `This transfer would make ${currentSource.name} negative. Confirm the negative balance to continue.`,
    );
  }

  const transactionResult = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note)
     VALUES ($1, 'TRANSFER', $2::date, NULL, $3)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId", note`,
    [userId, request.occurredOn, request.note ?? null],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction)
    throw new TransactionValidationError("Unable to create transfer.");

  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id)
     VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "TRANSFER",
        fromAccountId: request.fromAccountId,
        toAccountId: request.toAccountId,
        amountMinor: request.amountMinor,
        feeMinor: request.feeMinor ?? "0",
        feeCategoryId: request.feeCategoryId ?? null,
        occurredOn: request.occurredOn,
        note: request.note ?? null,
      }),
    ],
  );

  const postings = [
    {
      ledgerAccountId: source.ledgerAccountId,
      direction: "CREDIT" as const,
      amountMinor: moneyMinor((amount + fee).toString()),
    },
    {
      ledgerAccountId: destination.ledgerAccountId,
      direction: "DEBIT" as const,
      amountMinor: amount,
    },
    ...(fee > 0n && feeCategory
      ? [
          {
            ledgerAccountId: feeCategory.ledgerAccountId,
            direction: "DEBIT" as const,
            amountMinor: fee,
          },
        ]
      : []),
  ] as const;
  await postBalancedJournal(client, {
    userId,
    transactionId: transaction.id,
    operationKind: "TRANSFER",
    postings,
  });

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'POSTED', $3::jsonb)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "TRANSFER",
        fromAccountId: request.fromAccountId,
        toAccountId: request.toAccountId,
        amountMinor: request.amountMinor,
        feeMinor: request.feeMinor ?? "0",
        feeCategoryId: request.feeCategoryId ?? null,
      }),
    ],
  );

  return {
    transaction: mapTransaction(transaction),
    sourceAccount: await readFinancialAccount(
      client,
      userId,
      request.fromAccountId,
    ),
    destinationAccount: await readFinancialAccount(
      client,
      userId,
      request.toAccountId,
    ),
  };
}
