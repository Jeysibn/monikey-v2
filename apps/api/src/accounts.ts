import type { PoolClient } from "pg";
import { moneyMinor } from "@monikey/money";
import type { FinancialAccountCreateRequest } from "@monikey/contracts";
import { postBalancedJournal } from "./ledger/service.js";
import { ensureDefaultCategories } from "./categories.js";

export type FinancialAccountRecord = {
  id: string;
  type: FinancialAccountCreateRequest["type"];
  name: string;
  institution: string | null;
  currency: "PHP";
  balanceMinor: string;
  sortOrder: number;
  creditLimitMinor: string | null;
  statementDay: number | null;
  dueDay: number | null;
  archivedAt: string | null;
};

type FinancialAccountRow = {
  id: string;
  type: FinancialAccountRecord["type"];
  name: string;
  institution: string | null;
  currency: string;
  balanceMinor: string;
  sortOrder: number;
  creditLimitMinor: string | null;
  statementDay: number | null;
  dueDay: number | null;
  archivedAt: Date | null;
};

export class AccountNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super("The requested account was not found.");
    this.name = "AccountNotFoundError";
  }
}

export class AccountConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = "The first account has already been created.") {
    super(message);
    this.name = "AccountConflictError";
  }
}

function mapAccount(row: FinancialAccountRow): FinancialAccountRecord {
  return {
    ...row,
    currency: "PHP",
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

const accountSelect = `
  SELECT a.id,
         a.type,
         a.name,
         a.institution,
         a.currency,
         a.sort_order AS "sortOrder",
         a.credit_limit_minor::text AS "creditLimitMinor",
         a.statement_day AS "statementDay",
         a.due_day AS "dueDay",
         a.archived_at AS "archivedAt",
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
         )::text AS "balanceMinor"
    FROM financial_accounts a
    LEFT JOIN ledger_accounts la
      ON la.user_id = a.user_id AND la.financial_account_id = a.id
    LEFT JOIN postings p
      ON p.user_id = la.user_id AND p.ledger_account_id = la.id`;

async function queryAccount(
  client: PoolClient,
  userId: string,
  accountId: string,
  lock = false,
): Promise<FinancialAccountRecord> {
  if (lock) {
    const locked = await client.query(
      `SELECT id FROM financial_accounts WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [userId, accountId],
    );
    if (locked.rowCount === 0) throw new AccountNotFoundError();
  }
  const result = await client.query<FinancialAccountRow>(
    `${accountSelect}
      WHERE a.user_id = $1 AND a.id = $2
      GROUP BY a.id, la.id`,
    [userId, accountId],
  );
  const account = result.rows[0];
  if (!account) throw new AccountNotFoundError();
  return mapAccount(account);
}

export async function listFinancialAccounts(
  client: PoolClient,
  userId: string,
  includeArchived = false,
): Promise<FinancialAccountRecord[]> {
  const result = await client.query<FinancialAccountRow>(
    `${accountSelect}
      WHERE a.user_id = $1 AND ($2::boolean OR a.archived_at IS NULL)
      GROUP BY a.id, la.id
      ORDER BY a.sort_order, a.name, a.id`,
    [userId, includeArchived],
  );
  return result.rows.map(mapAccount);
}

export async function readFinancialAccount(
  client: PoolClient,
  userId: string,
  accountId: string,
): Promise<FinancialAccountRecord> {
  return queryAccount(client, userId, accountId);
}

export async function createFinancialAccount(
  client: PoolClient,
  userId: string,
  request: FinancialAccountCreateRequest,
  occurredOn: string,
): Promise<FinancialAccountRecord> {
  const accountResult = await client.query<{ id: string }>(
    `INSERT INTO financial_accounts
       (user_id, type, name, institution, credit_limit_minor, statement_day, due_day)
     VALUES ($1, $2, $3, $4, $5::bigint, $6, $7)
     RETURNING id`,
    [
      userId,
      request.type,
      request.name,
      request.institution ?? null,
      request.creditLimitMinor ?? null,
      request.statementDay ?? null,
      request.dueDay ?? null,
    ],
  );
  const accountId = accountResult.rows[0]!.id;
  const ledgerType = request.type === "CREDIT_CARD" ? "LIABILITY" : "ASSET";
  const ledgerAccount = await client.query<{ id: string }>(
    `INSERT INTO ledger_accounts (user_id, type, financial_account_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, ledgerType, accountId],
  );

  const openingAmount = moneyMinor(request.openingBalanceMinor);
  if (openingAmount > 0n) {
    await client.query(
      `INSERT INTO ledger_accounts (user_id, type, internal_code)
       VALUES ($1, 'EQUITY', 'OPENING_BALANCE')
       ON CONFLICT (user_id, internal_code) WHERE internal_code IS NOT NULL
       DO NOTHING`,
      [userId],
    );
    const equityAccount = await client.query<{ id: string }>(
      `SELECT id FROM ledger_accounts
        WHERE user_id = $1 AND type = 'EQUITY' AND internal_code = 'OPENING_BALANCE'`,
      [userId],
    );
    const transaction = await client.query<{ id: string }>(
      `INSERT INTO transactions (user_id, kind, occurred_on)
       VALUES ($1, 'OPENING_BALANCE', $2::date)
       RETURNING id`,
      [userId, occurredOn],
    );
    const transactionId = transaction.rows[0]!.id;
    await client.query(
      `INSERT INTO transaction_revisions
         (user_id, transaction_id, version, before_json, after_json, actor_id)
       VALUES ($1, $2, 1, NULL, $3::jsonb, $1)`,
      [
        userId,
        transactionId,
        JSON.stringify({
          kind: "OPENING_BALANCE",
          accountId,
          openingBalanceMinor: request.openingBalanceMinor,
        }),
      ],
    );
    const financialLeg = {
      ledgerAccountId: ledgerAccount.rows[0]!.id,
      direction: request.type === "CREDIT_CARD" ? "CREDIT" : "DEBIT",
      amountMinor: openingAmount,
    } as const;
    const equityLeg = {
      ledgerAccountId: equityAccount.rows[0]!.id,
      direction: request.type === "CREDIT_CARD" ? "DEBIT" : "CREDIT",
      amountMinor: openingAmount,
    } as const;
    await postBalancedJournal(client, {
      userId,
      transactionId,
      operationKind: "OPENING_BALANCE",
      postings: [financialLeg, equityLeg],
    });
  }

  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'FINANCIAL_ACCOUNT', $2, 'CREATED', $3::jsonb)`,
    [
      userId,
      accountId,
      JSON.stringify({
        accountType: request.type,
        hasOpeningBalance: openingAmount > 0n,
      }),
    ],
  );
  await ensureDefaultCategories(client, userId);
  return queryAccount(client, userId, accountId);
}

export async function createFirstFinancialAccount(
  client: PoolClient,
  userId: string,
  request: FinancialAccountCreateRequest,
  occurredOn: string,
): Promise<FinancialAccountRecord> {
  const owner = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  if (owner.rowCount === 0) throw new AccountNotFoundError();
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM financial_accounts WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (existing.rows.length > 0) throw new AccountConflictError();
  return createFinancialAccount(client, userId, request, occurredOn);
}

export async function updateFinancialAccount(
  client: PoolClient,
  userId: string,
  accountId: string,
  patch: { name?: string; sortOrder?: number },
): Promise<FinancialAccountRecord> {
  const current = await queryAccount(client, userId, accountId, true);
  if (current.archivedAt) throw new AccountNotFoundError();
  const name = patch.name ?? current.name;
  const sortOrder = patch.sortOrder ?? current.sortOrder;
  if (current.name === name && current.sortOrder === sortOrder) return current;
  await client.query(
    `UPDATE financial_accounts SET name = $3, sort_order = $4, updated_at = now()
      WHERE user_id = $1 AND id = $2 AND archived_at IS NULL`,
    [userId, accountId, name, sortOrder],
  );
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'FINANCIAL_ACCOUNT', $2, 'UPDATED', $3::jsonb)`,
    [
      userId,
      accountId,
      JSON.stringify({
        nameChanged: current.name !== name,
        orderChanged: current.sortOrder !== sortOrder,
      }),
    ],
  );
  return queryAccount(client, userId, accountId);
}

export async function archiveFinancialAccount(
  client: PoolClient,
  userId: string,
  accountId: string,
): Promise<FinancialAccountRecord> {
  const current = await queryAccount(client, userId, accountId, true);
  if (current.archivedAt) return current;
  await client.query(
    `UPDATE financial_accounts SET archived_at = now(), updated_at = now()
      WHERE user_id = $1 AND id = $2 AND archived_at IS NULL`,
    [userId, accountId],
  );
  await client.query(
    `INSERT INTO audit_events
       (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
     VALUES ($1, $1, 'FINANCIAL_ACCOUNT', $2, 'ARCHIVED', '{}'::jsonb)`,
    [userId, accountId],
  );
  return queryAccount(client, userId, accountId);
}
