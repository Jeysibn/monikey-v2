import type { PoolClient } from "pg";
import { moneyMinor } from "@monikey/money";
import type {
  AdjustmentCreateRequest,
  CardPaymentCreateRequest,
  TransactionActivityQuery,
  TransactionCreateRequest,
  TransactionDeleteRequest,
  TransactionEditRequest,
  TransactionKindSchema,
  RefundCreateRequest,
  TransferCreateRequest,
} from "@monikey/contracts";
import {
  readFinancialAccount,
  type FinancialAccountRecord,
} from "./accounts.js";
import { postBalancedJournal } from "./ledger/service.js";

type TransactionKind = (typeof TransactionKindSchema)["_output"];

type TransactionMutationRow = {
  id: string;
  kind: TransactionKind;
  status: "POSTED" | "VOID";
  currentRevision: number;
  occurredOn: string;
  categoryId: string | null;
  refundedTransactionId: string | null;
  note: string | null;
  afterJson: Record<string, unknown>;
};

type ActivityCursor = {
  occurredOn: string;
  createdAt: string;
  id: string;
};

type TransactionActivityRow = TransactionMutationRow & {
  createdAt: Date;
  createdAtCursor: string;
};

export type TransactionRecord = {
  id: string;
  kind: TransactionKind;
  status: "POSTED" | "VOID";
  currentRevision: number;
  occurredOn: string;
  categoryId: string | null;
  refundedTransactionId: string | null;
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

export type CardPaymentCreateResult = {
  transaction: TransactionRecord;
  cardAccount: FinancialAccountRecord;
  fundingAccount: FinancialAccountRecord;
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
  refundedTransactionId: string | null;
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
  allowArchived = false,
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
  if (!allowArchived && category.archivedAt) {
    throw new TransactionNotFoundError();
  }
  return category;
}

async function readOwnedRefundTarget(
  client: PoolClient,
  userId: string,
  transactionId: string,
): Promise<{ id: string; categoryId: string; amountMinor: string }> {
  const result = await client.query<{
    id: string;
    categoryId: string;
    amountMinor: string;
  }>(
    `SELECT t.id, t.category_id AS "categoryId", p.amount_minor::text AS "amountMinor"
       FROM transactions t
       JOIN journals j
         ON j.user_id = t.user_id AND j.transaction_id = t.id
       JOIN postings p
         ON p.user_id = j.user_id AND p.journal_id = j.id
      WHERE t.user_id = $1
        AND t.id = $2
        AND t.kind = 'EXPENSE'
        AND t.status = 'POSTED'
        AND p.direction = 'DEBIT'
        AND t.category_id IS NOT NULL
      ORDER BY j.created_at DESC
      LIMIT 1
      FOR UPDATE OF t`,
    [userId, transactionId],
  );
  const target = result.rows[0];
  if (!target) throw new TransactionNotFoundError();
  return target;
}

async function readRefundedAmount(
  client: PoolClient,
  userId: string,
  transactionId: string,
): Promise<bigint> {
  const result = await client.query<{ amount: string }>(
    `SELECT COALESCE(sum(p.amount_minor), 0)::text AS amount
       FROM transactions t
       JOIN journals j
         ON j.user_id = t.user_id AND j.transaction_id = t.id
       JOIN postings p
         ON p.user_id = j.user_id AND p.journal_id = j.id
       JOIN ledger_accounts la
         ON la.user_id = p.user_id AND la.id = p.ledger_account_id
      WHERE t.user_id = $1
        AND t.refunded_transaction_id = $2
        AND t.kind = 'REFUND'
        AND t.status = 'POSTED'
        AND la.financial_account_id IS NOT NULL`,
    [userId, transactionId],
  );
  return BigInt(result.rows[0]?.amount ?? "0");
}

async function ensureAdjustmentLedgerAccount(
  client: PoolClient,
  userId: string,
): Promise<string> {
  await client.query(
    `INSERT INTO ledger_accounts (user_id, type, internal_code)
     VALUES ($1, 'EQUITY', 'ADJUSTMENT')
     ON CONFLICT (user_id, internal_code) WHERE internal_code IS NOT NULL
     DO NOTHING`,
    [userId],
  );
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ledger_accounts
      WHERE user_id = $1 AND type = 'EQUITY' AND internal_code = 'ADJUSTMENT'`,
    [userId],
  );
  const account = result.rows[0];
  if (!account)
    throw new TransactionValidationError(
      "Unable to create adjustment account.",
    );
  return account.id;
}

async function readTransactionForMutation(
  client: PoolClient,
  userId: string,
  transactionId: string,
  lock = false,
): Promise<TransactionMutationRow> {
  const result = await client.query<TransactionMutationRow>(
    `SELECT t.id, t.kind, t.status,
            t.current_revision AS "currentRevision",
            t.occurred_on::text AS "occurredOn",
            t.category_id AS "categoryId",
            t.refunded_transaction_id AS "refundedTransactionId",
            t.note,
            r.after_json AS "afterJson"
       FROM transactions t
       JOIN transaction_revisions r
         ON r.user_id = t.user_id
        AND r.transaction_id = t.id
        AND r.version = t.current_revision
      WHERE t.user_id = $1 AND t.id = $2
      ${lock ? "FOR UPDATE OF t" : ""}`,
    [userId, transactionId],
  );
  const transaction = result.rows[0];
  if (!transaction) throw new TransactionNotFoundError();
  return transaction;
}

async function readActiveJournal(
  client: PoolClient,
  userId: string,
  transactionId: string,
): Promise<{ id: string; operationKind: string }> {
  const result = await client.query<{ id: string; operationKind: string }>(
    `SELECT j.id, j.operation_kind AS "operationKind"
       FROM journals j
      WHERE j.user_id = $1
        AND j.transaction_id = $2
        AND j.reversal_of IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM journals r
           WHERE r.user_id = j.user_id AND r.reversal_of = j.id
        )
      ORDER BY j.created_at DESC, j.id DESC
      LIMIT 1
      FOR UPDATE`,
    [userId, transactionId],
  );
  const journal = result.rows[0];
  if (!journal) {
    throw new TransactionConflictError(
      "The transaction does not have an active journal to reverse.",
    );
  }
  return journal;
}

async function reverseActiveJournal(
  client: PoolClient,
  userId: string,
  transactionId: string,
): Promise<{ originalJournalId: string; reversalJournalId: string }> {
  const journal = await readActiveJournal(client, userId, transactionId);
  const postings = await client.query<{
    ledgerAccountId: string;
    direction: "DEBIT" | "CREDIT";
    amountMinor: string;
  }>(
    `SELECT ledger_account_id AS "ledgerAccountId", direction,
            amount_minor::text AS "amountMinor"
       FROM postings
      WHERE user_id = $1 AND journal_id = $2
      ORDER BY id`,
    [userId, journal.id],
  );
  if (postings.rows.length < 2) {
    throw new TransactionConflictError(
      "The transaction journal cannot be reversed safely.",
    );
  }
  const reversalJournalId = await postBalancedJournal(client, {
    userId,
    transactionId,
    operationKind: "REVERSAL",
    reversalOf: journal.id,
    postings: postings.rows.map((posting) => ({
      ledgerAccountId: posting.ledgerAccountId,
      direction: posting.direction === "DEBIT" ? "CREDIT" : "DEBIT",
      amountMinor: moneyMinor(posting.amountMinor),
    })),
  });
  return { originalJournalId: journal.id, reversalJournalId };
}

function revisionCommandFromRow(transaction: TransactionMutationRow) {
  return {
    ...transaction.afterJson,
    kind: transaction.kind,
    occurredOn: transaction.occurredOn,
    note: transaction.note,
  };
}

function sourceAccountIdFromRevision(
  transaction: TransactionMutationRow,
): string {
  const value = transaction.afterJson.sourceAccountId;
  if (typeof value !== "string") {
    throw new TransactionConflictError(
      "This transaction cannot be edited because its source account is unavailable.",
    );
  }
  return value;
}

async function lockAccountsInOrder(
  client: PoolClient,
  userId: string,
  accountIds: string[],
) {
  const uniqueIds = [...new Set(accountIds)].sort();
  const accounts = new Map<
    string,
    Awaited<ReturnType<typeof readOwnedAccountForPosting>>
  >();
  for (const accountId of uniqueIds) {
    accounts.set(
      accountId,
      await readOwnedAccountForPosting(client, userId, accountId),
    );
  }
  return accounts;
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
  if (account.type === "CREDIT_CARD" && request.kind !== "EXPENSE") {
    throw new TransactionConflictError(
      "Credit card accounts can only record purchases as expenses.",
    );
  }

  const category = await readOwnedCategoryForPosting(
    client,
    userId,
    request.categoryId,
  );
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
    account.type !== "CREDIT_CARD" &&
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
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note)
     VALUES ($1, $2, $3::date, $4, $5)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId",
               refunded_transaction_id AS "refundedTransactionId", note`,
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
    direction:
      account.type === "CREDIT_CARD"
        ? "CREDIT"
        : request.kind === "EXPENSE"
          ? "CREDIT"
          : "DEBIT",
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
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note, refunded_transaction_id)
     VALUES ($1, 'TRANSFER', $2::date, NULL, $3, NULL)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId",
               refunded_transaction_id AS "refundedTransactionId", note`,
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

export async function createRefund(
  client: PoolClient,
  userId: string,
  request: RefundCreateRequest,
  serverToday: string,
): Promise<TransactionCreateResult> {
  assertOccurredOnNotFuture(request.occurredOn, serverToday);
  const amount = moneyMinor(request.amountMinor);
  const source = await readOwnedAccountForPosting(
    client,
    userId,
    request.sourceAccountId,
  );
  if (source.archivedAt) throw new TransactionNotFoundError();
  const currentSource = await readFinancialAccount(
    client,
    userId,
    request.sourceAccountId,
  );
  if (
    source.type === "CREDIT_CARD" &&
    BigInt(currentSource.balanceMinor) < amount &&
    request.acknowledgeCardCreditBalance !== true
  ) {
    throw new TransactionConflictError(
      `This refund would create a card credit balance of ${moneyMinor((amount - BigInt(currentSource.balanceMinor)).toString())} minor units on ${currentSource.name}. Confirm the card credit to continue.`,
    );
  }

  const original = await readOwnedRefundTarget(
    client,
    userId,
    request.refundedTransactionId,
  );
  const alreadyRefunded = await readRefundedAmount(
    client,
    userId,
    request.refundedTransactionId,
  );
  const remaining = BigInt(original.amountMinor) - alreadyRefunded;
  if (amount > remaining) {
    throw new TransactionConflictError(
      "The refund exceeds the remaining amount of the original expense.",
    );
  }

  const transactionResult = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note, refunded_transaction_id)
     VALUES ($1, 'REFUND', $2::date, $3, $4, $5)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId",
               refunded_transaction_id AS "refundedTransactionId", note`,
    [
      userId,
      request.occurredOn,
      original.categoryId,
      request.note ?? null,
      request.refundedTransactionId,
    ],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction)
    throw new TransactionValidationError("Unable to create refund.");

  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id)
     VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "REFUND",
        sourceAccountId: request.sourceAccountId,
        refundedTransactionId: request.refundedTransactionId,
        categoryId: original.categoryId,
        amountMinor: request.amountMinor,
        occurredOn: request.occurredOn,
        note: request.note ?? null,
      }),
    ],
  );

  await postBalancedJournal(client, {
    userId,
    transactionId: transaction.id,
    operationKind: "REFUND",
    postings: [
      {
        ledgerAccountId: source.ledgerAccountId,
        // Both a bank refund receipt and a card liability reduction are debits.
        direction: "DEBIT",
        amountMinor: amount,
      },
      {
        ledgerAccountId: (
          await readOwnedCategoryForPosting(
            client,
            userId,
            original.categoryId,
            true,
          )
        ).ledgerAccountId,
        direction: "CREDIT",
        amountMinor: amount,
      },
    ],
  });

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'POSTED', $3::jsonb)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "REFUND",
        sourceAccountId: request.sourceAccountId,
        refundedTransactionId: request.refundedTransactionId,
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

export async function createAdjustment(
  client: PoolClient,
  userId: string,
  request: AdjustmentCreateRequest,
  serverToday: string,
): Promise<TransactionCreateResult> {
  assertOccurredOnNotFuture(request.occurredOn, serverToday);
  const amount = moneyMinor(request.amountMinor);
  const account = await readOwnedAccountForPosting(
    client,
    userId,
    request.accountId,
  );
  if (account.archivedAt) throw new TransactionNotFoundError();
  const current = await readFinancialAccount(client, userId, request.accountId);
  if (
    request.direction === "DECREASE" &&
    account.type !== "CREDIT_CARD" &&
    BigInt(current.balanceMinor) < amount &&
    request.acknowledgeNegativeBalance !== true
  ) {
    throw new TransactionConflictError(
      `This adjustment would make ${current.name} negative. Confirm the negative balance to continue.`,
    );
  }
  if (
    account.type === "CREDIT_CARD" &&
    request.direction === "DECREASE" &&
    BigInt(current.balanceMinor) < amount &&
    request.acknowledgeCardCreditBalance !== true
  ) {
    throw new TransactionConflictError(
      `This adjustment would create a card credit balance of ${moneyMinor((amount - BigInt(current.balanceMinor)).toString())} minor units on ${current.name}. Confirm the card credit to continue.`,
    );
  }

  const transactionResult = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note, refunded_transaction_id)
     VALUES ($1, 'ADJUSTMENT', $2::date, NULL, $3, NULL)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId",
               refunded_transaction_id AS "refundedTransactionId", note`,
    [userId, request.occurredOn, request.note ?? null],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction)
    throw new TransactionValidationError("Unable to create adjustment.");

  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id)
     VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "ADJUSTMENT",
        accountId: request.accountId,
        direction: request.direction,
        amountMinor: request.amountMinor,
        occurredOn: request.occurredOn,
        note: request.note ?? null,
      }),
    ],
  );

  const adjustmentLedgerAccountId = await ensureAdjustmentLedgerAccount(
    client,
    userId,
  );
  const accountIncreasesWithDebit = account.type !== "CREDIT_CARD";
  const accountDirection =
    request.direction === "INCREASE"
      ? accountIncreasesWithDebit
        ? "DEBIT"
        : "CREDIT"
      : accountIncreasesWithDebit
        ? "CREDIT"
        : "DEBIT";
  const adjustmentDirection = accountDirection === "DEBIT" ? "CREDIT" : "DEBIT";
  await postBalancedJournal(client, {
    userId,
    transactionId: transaction.id,
    operationKind: "ADJUSTMENT",
    postings: [
      {
        ledgerAccountId: account.ledgerAccountId,
        direction: accountDirection,
        amountMinor: amount,
      },
      {
        ledgerAccountId: adjustmentLedgerAccountId,
        direction: adjustmentDirection,
        amountMinor: amount,
      },
    ],
  });

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'POSTED', $3::jsonb)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "ADJUSTMENT",
        accountId: request.accountId,
        direction: request.direction,
        amountMinor: request.amountMinor,
      }),
    ],
  );

  return {
    transaction: mapTransaction(transaction),
    account: await readFinancialAccount(client, userId, request.accountId),
  };
}

export async function createCardPayment(
  client: PoolClient,
  userId: string,
  cardAccountId: string,
  request: CardPaymentCreateRequest,
  serverToday: string,
): Promise<CardPaymentCreateResult> {
  assertOccurredOnNotFuture(request.occurredOn, serverToday);
  if (cardAccountId === request.fundingAccountId) {
    throw new TransactionConflictError(
      "A card payment needs a separate funding account.",
    );
  }
  const amount = moneyMinor(request.amountMinor);
  const accounts = await lockAccountsInOrder(client, userId, [
    cardAccountId,
    request.fundingAccountId,
  ]);
  const cardAccount = accounts.get(cardAccountId)!;
  const fundingAccount = accounts.get(request.fundingAccountId)!;
  if (cardAccount.archivedAt || fundingAccount.archivedAt) {
    throw new TransactionNotFoundError();
  }
  if (cardAccount.type !== "CREDIT_CARD") {
    throw new TransactionConflictError(
      "Payments can only settle a credit card account.",
    );
  }
  if (fundingAccount.type === "CREDIT_CARD") {
    throw new TransactionConflictError(
      "A card payment must be funded by cash, bank, or e-wallet money.",
    );
  }

  if (request.statementId) {
    const statementLock = await client.query<{
      cardAccountId: string;
      amountDueMinor: string;
    }>(
      `SELECT card_account_id AS "cardAccountId", amount_due_minor::text AS "amountDueMinor"
         FROM card_statements
        WHERE user_id = $1 AND id = $2
        FOR UPDATE`,
      [userId, request.statementId],
    );
    const statement = statementLock.rows[0];
    if (!statement || statement.cardAccountId !== cardAccountId) {
      throw new TransactionNotFoundError();
    }
    const allocated = await client.query<{ amount: string }>(
      `SELECT COALESCE(sum(amount_minor), 0)::text AS amount
         FROM card_statement_allocations
        WHERE user_id = $1 AND statement_id = $2 AND reversed_at IS NULL`,
      [userId, request.statementId],
    );
    const remaining =
      BigInt(statement.amountDueMinor) -
      BigInt(allocated.rows[0]?.amount ?? "0");
    if (amount > remaining) {
      throw new TransactionConflictError(
        "The payment exceeds the remaining amount due on this statement.",
      );
    }
  }

  const currentFunding = await readFinancialAccount(
    client,
    userId,
    request.fundingAccountId,
  );
  if (
    BigInt(currentFunding.balanceMinor) < amount &&
    request.acknowledgeNegativeBalance !== true
  ) {
    throw new TransactionConflictError(
      `This payment would make ${currentFunding.name} negative. Confirm the negative balance to continue.`,
    );
  }
  const currentCard = await readFinancialAccount(client, userId, cardAccountId);
  if (
    BigInt(currentCard.balanceMinor) < amount &&
    request.acknowledgeCardCreditBalance !== true
  ) {
    throw new TransactionConflictError(
      `This payment would create a card credit balance of ${moneyMinor((amount - BigInt(currentCard.balanceMinor)).toString())} minor units on ${currentCard.name}. Confirm the card credit to continue.`,
    );
  }

  const transactionResult = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `INSERT INTO transactions
       (user_id, kind, occurred_on, category_id, note, refunded_transaction_id)
     VALUES ($1, 'CARD_PAYMENT', $2::date, NULL, $3, NULL)
     RETURNING id, kind, status, current_revision AS "currentRevision",
               occurred_on::text AS "occurredOn", category_id AS "categoryId",
               refunded_transaction_id AS "refundedTransactionId", note`,
    [userId, request.occurredOn, request.note ?? null],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction)
    throw new TransactionValidationError("Unable to create card payment.");

  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id)
     VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "CARD_PAYMENT",
        cardAccountId,
        fundingAccountId: request.fundingAccountId,
        amountMinor: request.amountMinor,
        ...(request.statementId ? { statementId: request.statementId } : {}),
        occurredOn: request.occurredOn,
        note: request.note ?? null,
      }),
    ],
  );

  await postBalancedJournal(client, {
    userId,
    transactionId: transaction.id,
    operationKind: "CARD_PAYMENT",
    postings: [
      {
        ledgerAccountId: cardAccount.ledgerAccountId,
        direction: "DEBIT",
        amountMinor: amount,
      },
      {
        ledgerAccountId: fundingAccount.ledgerAccountId,
        direction: "CREDIT",
        amountMinor: amount,
      },
    ],
  });

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'POSTED', $3::jsonb)`,
    [
      userId,
      transaction.id,
      JSON.stringify({
        kind: "CARD_PAYMENT",
        cardAccountId,
        fundingAccountId: request.fundingAccountId,
        amountMinor: request.amountMinor,
      }),
    ],
  );

  if (request.statementId) {
    await client.query(
      `INSERT INTO card_statement_allocations
         (user_id, statement_id, transaction_id, amount_minor)
       VALUES ($1, $2, $3, $4::bigint)`,
      [userId, request.statementId, transaction.id, request.amountMinor],
    );
  }

  return {
    transaction: mapTransaction(transaction),
    cardAccount: await readFinancialAccount(client, userId, cardAccountId),
    fundingAccount: await readFinancialAccount(
      client,
      userId,
      request.fundingAccountId,
    ),
  };
}

export async function editIncomeOrExpense(
  client: PoolClient,
  userId: string,
  transactionId: string,
  request: TransactionEditRequest,
  serverToday: string,
): Promise<TransactionCreateResult> {
  assertOccurredOnNotFuture(request.occurredOn, serverToday);
  const transaction = await readTransactionForMutation(
    client,
    userId,
    transactionId,
    true,
  );
  if (transaction.status !== "POSTED") {
    throw new TransactionConflictError("A void transaction cannot be edited.");
  }
  if (transaction.kind !== "INCOME" && transaction.kind !== "EXPENSE") {
    throw new TransactionConflictError(
      "Only income and expense transactions can be edited by this command.",
    );
  }
  if (transaction.kind !== request.kind) {
    throw new TransactionConflictError(
      "Editing cannot change the transaction kind.",
    );
  }

  const oldSourceAccountId = sourceAccountIdFromRevision(transaction);
  const accounts = await lockAccountsInOrder(client, userId, [
    oldSourceAccountId,
    request.sourceAccountId,
  ]);
  const oldAccount = accounts.get(oldSourceAccountId)!;
  const newAccount = accounts.get(request.sourceAccountId)!;
  if (newAccount.archivedAt) throw new TransactionNotFoundError();
  if (newAccount.type === "CREDIT_CARD" && request.kind !== "EXPENSE") {
    throw new TransactionConflictError(
      "Credit card accounts can only record purchases as expenses.",
    );
  }
  const category = await readOwnedCategoryForPosting(
    client,
    userId,
    request.categoryId,
  );
  if (category.kind !== request.kind) {
    throw new TransactionConflictError(
      "The category kind does not match the transaction kind.",
    );
  }

  const oldAmountValue = transaction.afterJson.amountMinor;
  if (typeof oldAmountValue !== "string") {
    throw new TransactionConflictError(
      "This transaction cannot be edited because its amount is unavailable.",
    );
  }
  const oldAmount = moneyMinor(oldAmountValue);
  const newAmount = moneyMinor(request.amountMinor);
  for (const candidate of new Set([
    oldSourceAccountId,
    request.sourceAccountId,
  ])) {
    const candidateAccount = accounts.get(candidate)!;
    if (candidateAccount.type !== "CREDIT_CARD") continue;
    const current = await readFinancialAccount(client, userId, candidate);
    let projected = BigInt(current.balanceMinor);
    if (candidate === oldSourceAccountId && oldAccount.type === "CREDIT_CARD") {
      // Reversing a card expense reduces its liability balance. Card balances
      // can be negative after an overpayment, so this can increase the credit.
      projected -= oldAmount;
    }
    if (
      candidate === request.sourceAccountId &&
      newAccount.type === "CREDIT_CARD"
    ) {
      projected += newAmount;
    }
    if (projected < 0n && request.acknowledgeCardCreditBalance !== true) {
      throw new TransactionConflictError(
        `This correction would create a card credit balance of ${moneyMinor((-projected).toString())} minor units on ${current.name}. Confirm the card credit to continue.`,
      );
    }
  }
  if (transaction.kind === "EXPENSE") {
    const alreadyRefunded = await readRefundedAmount(
      client,
      userId,
      transactionId,
    );
    if (alreadyRefunded > 0n) {
      if (newAmount < alreadyRefunded) {
        throw new TransactionConflictError(
          "The expense cannot be reduced below its posted refund total. Void or edit linked refunds first.",
        );
      }
      if (request.categoryId !== transaction.categoryId) {
        throw new TransactionConflictError(
          "The category cannot change while posted refunds are linked to this expense. Void linked refunds first.",
        );
      }
    }
  }
  for (const candidateId of new Set([
    oldSourceAccountId,
    request.sourceAccountId,
  ])) {
    const candidateAccount = accounts.get(candidateId)!;
    if (candidateAccount.type === "CREDIT_CARD") continue;
    const current = await readFinancialAccount(client, userId, candidateId);
    let projectedBalance = BigInt(current.balanceMinor);
    if (candidateId === oldSourceAccountId) {
      projectedBalance += request.kind === "EXPENSE" ? oldAmount : -oldAmount;
    }
    if (candidateId === request.sourceAccountId) {
      projectedBalance += request.kind === "EXPENSE" ? -newAmount : newAmount;
    }
    if (projectedBalance < 0n && request.acknowledgeNegativeBalance !== true) {
      throw new TransactionConflictError(
        `This correction would make ${current.name} negative by ${moneyMinor((-projectedBalance).toString())} minor units. Confirm the negative balance to continue.`,
      );
    }
  }

  const reversal = await reverseActiveJournal(client, userId, transactionId);
  const nextVersion = transaction.currentRevision + 1;
  const beforeJson = revisionCommandFromRow(transaction);
  const afterJson = {
    kind: request.kind,
    sourceAccountId: request.sourceAccountId,
    categoryId: request.categoryId,
    amountMinor: request.amountMinor,
    occurredOn: request.occurredOn,
    note: request.note ?? null,
  };
  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id, reason)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $1, $6)`,
    [
      userId,
      transactionId,
      nextVersion,
      JSON.stringify(beforeJson),
      JSON.stringify(afterJson),
      request.reason,
    ],
  );
  const linkedOccurrence = await client.query<{ id: string }>(
    `SELECT id FROM bill_occurrences
      WHERE user_id = $1 AND paid_transaction_id = $2
      FOR UPDATE`,
    [userId, transactionId],
  );
  if (linkedOccurrence.rows[0]) {
    await client.query(
      `UPDATE bill_occurrences
          SET actual_amount_minor = $3::bigint, updated_at = now()
        WHERE user_id = $1 AND id = $2 AND status = 'PAID'`,
      [userId, linkedOccurrence.rows[0].id, newAmount.toString()],
    );
    await client.query(
      `INSERT INTO bill_occurrence_payment_history
         (user_id, occurrence_id, transaction_id, sequence_number, action, amount_minor)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(sequence_number), 0) + 1
                  FROM bill_occurrence_payment_history
                 WHERE user_id = $1 AND occurrence_id = $2),
               'EDITED', $4::bigint)`,
      [
        userId,
        linkedOccurrence.rows[0].id,
        transactionId,
        newAmount.toString(),
      ],
    );
  }
  const updated = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `UPDATE transactions
        SET occurred_on = $3::date,
            category_id = $4,
            note = $5,
            current_revision = $6,
            updated_at = now()
      WHERE user_id = $1 AND id = $2
      RETURNING id, kind, status, current_revision AS "currentRevision",
                occurred_on::text AS "occurredOn", category_id AS "categoryId",
                refunded_transaction_id AS "refundedTransactionId", note`,
    [
      userId,
      transactionId,
      request.occurredOn,
      request.categoryId,
      request.note ?? null,
      nextVersion,
    ],
  );
  const updatedTransaction = updated.rows[0];
  if (!updatedTransaction)
    throw new TransactionValidationError("Unable to update transaction.");

  const amountPosting = {
    ledgerAccountId: newAccount.ledgerAccountId,
    direction:
      newAccount.type === "CREDIT_CARD"
        ? "CREDIT"
        : request.kind === "EXPENSE"
          ? "CREDIT"
          : "DEBIT",
    amountMinor: newAmount,
  } as const;
  const categoryPosting = {
    ledgerAccountId: category.ledgerAccountId,
    direction: request.kind === "EXPENSE" ? "DEBIT" : "CREDIT",
    amountMinor: newAmount,
  } as const;
  const replacementJournalId = await postBalancedJournal(client, {
    userId,
    transactionId,
    operationKind: request.kind,
    postings: [amountPosting, categoryPosting],
  });
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'UPDATED', $3::jsonb)`,
    [
      userId,
      transactionId,
      JSON.stringify({
        kind: request.kind,
        reason: request.reason,
        reversalJournalId: reversal.reversalJournalId,
        replacementJournalId,
      }),
    ],
  );
  return {
    transaction: mapTransaction(updatedTransaction),
    account: await readFinancialAccount(
      client,
      userId,
      request.sourceAccountId,
    ),
  };
}

export async function deleteTransaction(
  client: PoolClient,
  userId: string,
  transactionId: string,
  request: TransactionDeleteRequest,
  serverToday: string,
): Promise<TransactionRecord> {
  const transaction = await readTransactionForMutation(
    client,
    userId,
    transactionId,
    true,
  );
  if (transaction.status === "VOID") {
    throw new TransactionConflictError(
      "The transaction has already been voided.",
    );
  }
  if (transaction.kind === "OPENING_BALANCE") {
    throw new TransactionConflictError(
      "Opening balances cannot be voided from the transaction command.",
    );
  }
  if (
    transaction.kind === "EXPENSE" &&
    (await readRefundedAmount(client, userId, transactionId)) > 0n
  ) {
    throw new TransactionConflictError(
      "An expense with posted refunds cannot be voided. Void its linked refunds first.",
    );
  }
  const after = transaction.afterJson;
  const originalAmountText = after.amountMinor;
  if (typeof originalAmountText !== "string") {
    throw new TransactionConflictError(
      "This transaction cannot be reversed because its amount is unavailable.",
    );
  }
  const originalAmount = moneyMinor(originalAmountText);
  const originalFee =
    typeof after.feeMinor === "string" ? moneyMinor(after.feeMinor) : 0n;
  const accountIdFields = [
    "sourceAccountId",
    "accountId",
    "fromAccountId",
    "toAccountId",
    "fundingAccountId",
    "cardAccountId",
  ] as const;
  const accountIds = accountIdFields
    .map((field) => after[field])
    .filter((value): value is string => typeof value === "string");
  const lockedAccounts = await lockAccountsInOrder(client, userId, accountIds);
  const projectedDeltas = new Map<string, bigint>();
  const addProjectedDelta = (id: unknown, delta: bigint) => {
    if (typeof id !== "string") return;
    projectedDeltas.set(id, (projectedDeltas.get(id) ?? 0n) + delta);
  };
  switch (transaction.kind) {
    case "EXPENSE":
      addProjectedDelta(
        after.sourceAccountId,
        lockedAccounts.get(String(after.sourceAccountId))?.type ===
          "CREDIT_CARD"
          ? -originalAmount
          : originalAmount,
      );
      break;
    case "INCOME":
      addProjectedDelta(after.sourceAccountId, -originalAmount);
      break;
    case "TRANSFER":
      addProjectedDelta(after.fromAccountId, originalAmount + originalFee);
      addProjectedDelta(after.toAccountId, -originalAmount);
      break;
    case "REFUND":
      addProjectedDelta(
        after.sourceAccountId,
        lockedAccounts.get(String(after.sourceAccountId))?.type ===
          "CREDIT_CARD"
          ? originalAmount
          : -originalAmount,
      );
      break;
    case "ADJUSTMENT": {
      const direction = after.direction;
      const account = lockedAccounts.get(String(after.accountId));
      const increasesBalance = direction === "INCREASE";
      const reversalDelta =
        account?.type === "CREDIT_CARD"
          ? increasesBalance
            ? originalAmount
            : -originalAmount
          : increasesBalance
            ? -originalAmount
            : originalAmount;
      addProjectedDelta(after.accountId, reversalDelta);
      break;
    }
    case "CARD_PAYMENT":
      addProjectedDelta(after.cardAccountId, originalAmount);
      addProjectedDelta(after.fundingAccountId, originalAmount);
      break;
  }

  const creditBreaches: Array<{ name: string; amountMinor: bigint }> = [];
  const overdraftBreaches: Array<{ name: string; amountMinor: bigint }> = [];
  for (const [accountId, delta] of projectedDeltas) {
    const account = lockedAccounts.get(accountId);
    if (!account) throw new TransactionNotFoundError();
    const current = await readFinancialAccount(client, userId, accountId);
    const projected = BigInt(current.balanceMinor) + delta;
    if (account.type === "CREDIT_CARD" && projected < 0n) {
      creditBreaches.push({ name: current.name, amountMinor: -projected });
    } else if (account.type !== "CREDIT_CARD" && projected < 0n) {
      overdraftBreaches.push({ name: current.name, amountMinor: -projected });
    }
  }
  if (creditBreaches.length && request.acknowledgeCardCreditBalance !== true) {
    const breach = creditBreaches[0]!;
    throw new TransactionConflictError(
      `This reversal would create a card credit balance of ${moneyMinor(breach.amountMinor.toString())} minor units on ${breach.name}. Confirm the card credit to continue.`,
    );
  }
  if (overdraftBreaches.length && request.acknowledgeNegativeBalance !== true) {
    const breach = overdraftBreaches[0]!;
    throw new TransactionConflictError(
      `This reversal would make ${breach.name} negative by ${moneyMinor(breach.amountMinor.toString())} minor units. Confirm the negative balance to continue.`,
    );
  }
  const allocation = await client.query<{
    id: string;
    statementId: string;
  }>(
    `SELECT id, statement_id AS "statementId"
       FROM card_statement_allocations
      WHERE user_id = $1 AND transaction_id = $2 AND reversed_at IS NULL
      FOR UPDATE`,
    [userId, transactionId],
  );
  const linkedOccurrence = await client.query<{
    id: string;
    dueOn: string;
    actualAmountMinor: string;
  }>(
    `SELECT id, due_on::text AS "dueOn",
            actual_amount_minor::text AS "actualAmountMinor"
       FROM bill_occurrences
      WHERE user_id = $1 AND paid_transaction_id = $2
      FOR UPDATE`,
    [userId, transactionId],
  );
  const reversal = await reverseActiveJournal(client, userId, transactionId);
  const nextVersion = transaction.currentRevision + 1;
  const beforeJson = revisionCommandFromRow(transaction);
  const afterJson = { ...beforeJson, status: "VOID" };
  await client.query(
    `INSERT INTO transaction_revisions
       (user_id, transaction_id, version, before_json, after_json, actor_id, reason)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $1, $6)`,
    [
      userId,
      transactionId,
      nextVersion,
      JSON.stringify(beforeJson),
      JSON.stringify(afterJson),
      request.reason,
    ],
  );
  const updated = await client.query<{
    id: string;
    kind: TransactionKind;
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    refundedTransactionId: string | null;
    note: string | null;
  }>(
    `UPDATE transactions
        SET status = 'VOID', current_revision = $3, updated_at = now()
      WHERE user_id = $1 AND id = $2
      RETURNING id, kind, status, current_revision AS "currentRevision",
                occurred_on::text AS "occurredOn", category_id AS "categoryId",
                refunded_transaction_id AS "refundedTransactionId", note`,
    [userId, transactionId, nextVersion],
  );
  const updatedTransaction = updated.rows[0];
  if (!updatedTransaction)
    throw new TransactionValidationError("Unable to void transaction.");
  for (const activeAllocation of allocation.rows) {
    await client.query(
      `UPDATE card_statement_allocations
          SET reversed_at = now(), reversal_reason = $4
        WHERE user_id = $1 AND id = $2 AND transaction_id = $3
          AND reversed_at IS NULL`,
      [userId, activeAllocation.id, transactionId, request.reason],
    );
    await client.query(
      `INSERT INTO audit_events
         (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
       VALUES ($1, $1, 'CARD_STATEMENT_ALLOCATION', $2, 'REVERSED', $3::jsonb)`,
      [
        userId,
        activeAllocation.id,
        JSON.stringify({
          statementId: activeAllocation.statementId,
          transactionId,
          reason: request.reason,
        }),
      ],
    );
  }
  for (const occurrence of linkedOccurrence.rows) {
    await client.query(
      `INSERT INTO bill_occurrence_payment_history
         (user_id, occurrence_id, transaction_id, sequence_number, action, amount_minor)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(sequence_number), 0) + 1
                  FROM bill_occurrence_payment_history
                 WHERE user_id = $1 AND occurrence_id = $2),
               'VOIDED', $4::bigint)`,
      [userId, occurrence.id, transactionId, occurrence.actualAmountMinor],
    );
    await client.query(
      `UPDATE bill_occurrences
          SET status = CASE WHEN due_on < $3::date THEN 'OVERDUE' ELSE 'UPCOMING' END,
              actual_amount_minor = NULL, paid_transaction_id = NULL,
              paid_at = NULL, updated_at = now()
        WHERE user_id = $1 AND id = $2 AND status = 'PAID'`,
      [userId, occurrence.id, serverToday],
    );
  }
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'TRANSACTION', $2, 'VOIDED', $3::jsonb)`,
    [
      userId,
      transactionId,
      JSON.stringify({
        reason: request.reason,
        reversalJournalId: reversal.reversalJournalId,
      }),
    ],
  );
  return mapTransaction(updatedTransaction);
}

export async function readTransaction(
  client: PoolClient,
  userId: string,
  transactionId: string,
) {
  const transaction = await readTransactionForMutation(
    client,
    userId,
    transactionId,
  );
  return mapTransaction(transaction);
}

export async function readTransactionAudit(
  client: PoolClient,
  userId: string,
  transactionId: string,
) {
  const transaction = await readTransactionForMutation(
    client,
    userId,
    transactionId,
  );
  const revisions = await client.query<{
    version: number;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    reason: string | null;
    createdAt: Date;
  }>(
    `SELECT version, before_json AS before, after_json AS after, reason,
            created_at AS "createdAt"
       FROM transaction_revisions
      WHERE user_id = $1 AND transaction_id = $2
      ORDER BY version`,
    [userId, transactionId],
  );
  return {
    transaction: mapTransaction(transaction),
    revisions: revisions.rows.map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
  };
}

function decodeActivityCursor(
  value: string | undefined,
): ActivityCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ActivityCursor>;
    if (
      typeof decoded.occurredOn !== "string" ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string"
    ) {
      throw new Error("Invalid cursor");
    }
    return decoded as ActivityCursor;
  } catch {
    throw new TransactionValidationError("The activity cursor is invalid.");
  }
}

function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export async function listTransactions(
  client: PoolClient,
  userId: string,
  query: TransactionActivityQuery,
  accountIdOverride?: string,
) {
  const cursor = decodeActivityCursor(query.cursor);
  const accountId = accountIdOverride ?? query.accountId ?? null;
  const result = await client.query<TransactionActivityRow>(
    `SELECT t.id,
            t.kind,
            t.status,
            t.current_revision AS "currentRevision",
            t.occurred_on::text AS "occurredOn",
            t.category_id AS "categoryId",
            t.refunded_transaction_id AS "refundedTransactionId",
            t.note,
            t.created_at AS "createdAt",
            t.created_at::text AS "createdAtCursor",
            r.after_json AS "afterJson"
       FROM transactions t
       JOIN transaction_revisions r
         ON r.user_id = t.user_id
        AND r.transaction_id = t.id
        AND r.version = t.current_revision
      WHERE t.user_id = $1
        AND ($2::text IS NULL OR t.kind = $2)
        AND ($3::text IS NULL OR t.status = $3)
        AND ($4::uuid IS NULL OR t.category_id = $4)
        AND ($5::date IS NULL OR t.occurred_on >= $5::date)
        AND ($6::date IS NULL OR t.occurred_on <= $6::date)
        AND ($7::text IS NULL OR t.note ILIKE '%' || $7 || '%')
        AND ($8::uuid IS NULL OR (
          r.after_json ->> 'sourceAccountId' = $8::text OR
          r.after_json ->> 'accountId' = $8::text OR
          r.after_json ->> 'fromAccountId' = $8::text OR
          r.after_json ->> 'toAccountId' = $8::text
        ))
        AND ($9::date IS NULL OR $10::timestamptz IS NULL OR $11::uuid IS NULL OR
          (t.occurred_on, t.created_at, t.id) < ($9::date, $10::timestamptz, $11::uuid))
      ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
      LIMIT $12::integer`,
    [
      userId,
      query.kind ?? null,
      query.status ?? null,
      query.categoryId ?? null,
      query.from ?? null,
      query.to ?? null,
      query.search ?? null,
      accountId,
      cursor?.occurredOn ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      query.limit + 1,
    ],
  );
  const hasMore = result.rows.length > query.limit;
  const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
  const last = rows.at(-1);
  return {
    activity: rows.map((row) => ({
      transaction: mapTransaction(row),
      revision: row.afterJson,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      hasMore && last
        ? encodeActivityCursor({
            occurredOn: last.occurredOn,
            createdAt: last.createdAtCursor,
            id: last.id,
          })
        : null,
  };
}
