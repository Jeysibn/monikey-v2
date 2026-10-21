import type { PoolClient } from "pg";
import type {
  CategoryCreateRequest,
  CategoryKindSchema,
  CategoryPatchRequest,
} from "@monikey/contracts";
import type { z } from "zod";

type CategoryKind = z.infer<typeof CategoryKindSchema>;

export type CategoryRecord = {
  id: string;
  kind: CategoryKind;
  name: string;
  sortOrder: number;
  icon: string | null;
  archivedAt: string | null;
};

type CategoryRow = Omit<CategoryRecord, "archivedAt"> & {
  archivedAt: Date | null;
};

export class CategoryNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super("The requested category was not found.");
    this.name = "CategoryNotFoundError";
  }
}

export class CategoryConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("A category with this name already exists for this type.");
    this.name = "CategoryConflictError";
  }
}

const selectCategory = `
  SELECT id,
         kind,
         name,
         sort_order AS "sortOrder",
         icon,
         archived_at AS "archivedAt"
    FROM categories`;

function mapCategory(row: CategoryRow): CategoryRecord {
  return {
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function listCategories(
  client: PoolClient,
  userId: string,
  options: { kind?: CategoryKind; includeArchived?: boolean } = {},
): Promise<CategoryRecord[]> {
  const result = await client.query<CategoryRow>(
    `${selectCategory}
      WHERE user_id = $1
        AND ($2::text IS NULL OR kind = $2)
        AND ($3::boolean OR archived_at IS NULL)
      ORDER BY kind, sort_order, name, id`,
    [userId, options.kind ?? null, options.includeArchived ?? false],
  );
  return result.rows.map(mapCategory);
}

export async function createCategory(
  client: PoolClient,
  userId: string,
  request: CategoryCreateRequest,
): Promise<CategoryRecord> {
  try {
    const result = await client.query<CategoryRow>(
      `INSERT INTO categories (user_id, kind, name, sort_order, icon)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, kind, name, sort_order AS "sortOrder", icon,
                 archived_at AS "archivedAt"`,
      [
        userId,
        request.kind,
        request.name,
        request.sortOrder ?? 0,
        request.icon ?? null,
      ],
    );
    const category = result.rows[0];
    if (!category) throw new Error("Category insert returned no record.");
    await client.query(
      `INSERT INTO ledger_accounts (user_id, type, category_id)
       VALUES ($1, $2, $3)`,
      [userId, request.kind, category.id],
    );
    await client.query(
      `INSERT INTO audit_events
         (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
       VALUES ($1, $1, 'CATEGORY', $2, 'CREATED', $3::jsonb)`,
      [
        userId,
        category.id,
        JSON.stringify({
          kind: request.kind,
          hasIcon: request.icon !== undefined,
        }),
      ],
    );
    return mapCategory(category);
  } catch (error) {
    if (isUniqueViolation(error)) throw new CategoryConflictError();
    throw error;
  }
}

export async function updateCategory(
  client: PoolClient,
  userId: string,
  categoryId: string,
  patch: CategoryPatchRequest,
): Promise<CategoryRecord> {
  const locked = await client.query<CategoryRow>(
    `${selectCategory}
      WHERE user_id = $1 AND id = $2
      FOR UPDATE`,
    [userId, categoryId],
  );
  const current = locked.rows[0];
  if (!current) throw new CategoryNotFoundError();

  const name = patch.name ?? current.name;
  const sortOrder = patch.sortOrder ?? current.sortOrder;
  const icon = patch.icon === undefined ? current.icon : patch.icon;
  const archivedAt =
    patch.archived === undefined
      ? current.archivedAt
      : patch.archived
        ? (current.archivedAt ?? new Date())
        : null;
  if (
    name === current.name &&
    sortOrder === current.sortOrder &&
    icon === current.icon &&
    archivedAt?.getTime() === current.archivedAt?.getTime()
  ) {
    return mapCategory(current);
  }

  try {
    const updated = await client.query<CategoryRow>(
      `UPDATE categories
          SET name = $3, sort_order = $4, icon = $5, archived_at = $6,
              updated_at = now()
        WHERE user_id = $1 AND id = $2
        RETURNING id, kind, name, sort_order AS "sortOrder", icon,
                  archived_at AS "archivedAt"`,
      [userId, categoryId, name, sortOrder, icon, archivedAt],
    );
    const category = updated.rows[0];
    if (!category) throw new CategoryNotFoundError();
    await client.query(
      `INSERT INTO audit_events
         (user_id, actor_id, entity_type, entity_id, action, safe_metadata_json)
       VALUES ($1, $1, 'CATEGORY', $2, $3, $4::jsonb)`,
      [
        userId,
        categoryId,
        patch.archived === true
          ? "ARCHIVED"
          : patch.archived === false
            ? "RESTORED"
            : "UPDATED",
        JSON.stringify({
          nameChanged: name !== current.name,
          orderChanged: sortOrder !== current.sortOrder,
          iconChanged: icon !== current.icon,
        }),
      ],
    );
    return mapCategory(category);
  } catch (error) {
    if (isUniqueViolation(error)) throw new CategoryConflictError();
    throw error;
  }
}

const DEFAULT_CATEGORIES: ReadonlyArray<
  readonly [CategoryKind, string, number]
> = [
  ["EXPENSE", "Food", 100],
  ["EXPENSE", "Groceries", 200],
  ["EXPENSE", "Transportation", 300],
  ["EXPENSE", "Shopping", 400],
  ["EXPENSE", "Utilities", 500],
  ["EXPENSE", "Rent/Housing", 600],
  ["EXPENSE", "Subscriptions", 700],
  ["EXPENSE", "Health", 800],
  ["EXPENSE", "Other Expense", 900],
  ["INCOME", "Salary", 100],
  ["INCOME", "Freelance", 200],
  ["INCOME", "Gifts", 300],
  ["INCOME", "Other Income", 400],
];

/** Seed editable category defaults within the first-account transaction. */
export async function ensureDefaultCategories(
  client: PoolClient,
  userId: string,
): Promise<void> {
  const kinds = DEFAULT_CATEGORIES.map(([kind]) => kind);
  const names = DEFAULT_CATEGORIES.map(([, name]) => name);
  await client.query(
    `WITH defaults AS (
       SELECT * FROM unnest($2::text[], $3::text[], $4::integer[])
         AS d(kind, name, sort_order)
     )
     INSERT INTO categories (user_id, kind, name, sort_order)
     SELECT $1, kind, name, sort_order FROM defaults
     ON CONFLICT (user_id, kind, name) DO NOTHING`,
    [userId, kinds, names, DEFAULT_CATEGORIES.map(([, , order]) => order)],
  );
  await client.query(
    `WITH defaults AS (
       SELECT * FROM unnest($2::text[], $3::text[]) AS d(kind, name)
     )
     INSERT INTO ledger_accounts (user_id, type, category_id)
     SELECT $1, d.kind, c.id
       FROM defaults d
       JOIN categories c
         ON c.user_id = $1 AND c.kind = d.kind AND c.name = d.name
     ON CONFLICT DO NOTHING`,
    [userId, kinds, names],
  );
}
