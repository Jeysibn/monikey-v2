import type { PoolClient } from "pg";
import { assertBalancedPostings, type LedgerPostingInput } from "./domain.js";
import { recordLedgerInvariantValidationFailure } from "./invariant-metrics.js";

export type JournalOperationKind =
  | "OPENING_BALANCE"
  | "INCOME"
  | "EXPENSE"
  | "TRANSFER"
  | "REFUND"
  | "ADJUSTMENT"
  | "CARD_PAYMENT"
  | "REVERSAL";

export type PostBalancedJournalInput = {
  userId: string;
  transactionId: string;
  operationKind: JournalOperationKind;
  postings: readonly LedgerPostingInput[];
  reversalOf?: string;
};

export class LedgerNotFoundError extends Error {
  constructor() {
    super("The requested ledger resource was not found.");
    this.name = "LedgerNotFoundError";
  }
}

/**
 * Insert one balanced journal, its postings, and a safe audit event.
 *
 * The caller MUST pass a PoolClient with an open transaction. The same
 * transaction must include the user action and transaction revision; its
 * caller commits only after all required work succeeds.
 */
export async function postBalancedJournal(
  client: PoolClient,
  input: PostBalancedJournalInput,
): Promise<string> {
  try {
    assertBalancedPostings(input.postings);
  } catch (error) {
    recordLedgerInvariantValidationFailure(error);
    throw error;
  }
  if (
    (input.operationKind === "REVERSAL") !==
    (input.reversalOf !== undefined)
  ) {
    throw new Error(
      "Only reversal journals may reference a journal to reverse.",
    );
  }

  const transaction = await client.query<{
    kind: string;
    status: string;
    occurred_on: string;
  }>(
    `SELECT kind, status, occurred_on::text AS occurred_on
       FROM transactions
      WHERE user_id = $1 AND id = $2
      FOR UPDATE`,
    [input.userId, input.transactionId],
  );
  const transactionRow = transaction.rows[0];
  if (!transactionRow) throw new LedgerNotFoundError();
  if (
    transactionRow.status !== "POSTED" ||
    (input.operationKind !== "REVERSAL" &&
      transactionRow.kind !== input.operationKind)
  ) {
    throw new Error("Journal operation does not match a posted transaction.");
  }

  if (input.reversalOf) {
    const sourceJournal = await client.query<{ transaction_id: string }>(
      `SELECT transaction_id
         FROM journals
        WHERE user_id = $1 AND id = $2
        FOR UPDATE`,
      [input.userId, input.reversalOf],
    );
    if (sourceJournal.rows[0]?.transaction_id !== input.transactionId) {
      throw new LedgerNotFoundError();
    }
  }

  const accountIds = input.postings.map((posting) => posting.ledgerAccountId);
  const ownedLedgerAccounts = await client.query<{
    id: string;
    financial_account_id: string | null;
  }>(
    `SELECT id, financial_account_id
       FROM ledger_accounts
      WHERE user_id = $1 AND id = ANY($2::uuid[])
      ORDER BY id
      FOR KEY SHARE`,
    [input.userId, accountIds],
  );
  if (ownedLedgerAccounts.rowCount !== accountIds.length) {
    throw new LedgerNotFoundError();
  }

  const financialAccountIds = [
    ...new Set(
      ownedLedgerAccounts.rows
        .map((account) => account.financial_account_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (financialAccountIds.length > 0) {
    const lockedAccounts = await client.query<{ id: string }>(
      `SELECT id
         FROM financial_accounts
        WHERE user_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [input.userId, financialAccountIds],
    );
    if (lockedAccounts.rowCount !== financialAccountIds.length) {
      throw new LedgerNotFoundError();
    }
  }

  const journal = await client.query<{ id: string }>(
    `INSERT INTO journals
       (user_id, transaction_id, reversal_of, occurred_on, operation_kind)
     VALUES ($1, $2, $3, $4::date, $5)
     RETURNING id`,
    [
      input.userId,
      input.transactionId,
      input.reversalOf ?? null,
      transactionRow.occurred_on,
      input.operationKind,
    ],
  );
  const journalId = journal.rows[0]!.id;

  for (const posting of input.postings) {
    await client.query(
      `INSERT INTO postings
         (user_id, journal_id, ledger_account_id, direction, amount_minor)
       VALUES ($1, $2, $3, $4, $5::bigint)`,
      [
        input.userId,
        journalId,
        posting.ledgerAccountId,
        posting.direction,
        posting.amountMinor.toString(10),
      ],
    );
  }

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'JOURNAL', $2, 'POSTED', $3::jsonb)`,
    [
      input.userId,
      journalId,
      JSON.stringify({
        transactionId: input.transactionId,
        operationKind: input.operationKind,
        postingCount: input.postings.length,
      }),
    ],
  );

  return journalId;
}
