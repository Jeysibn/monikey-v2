import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["connected", "unconfigured", "unavailable"]),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const LoginResponseSchema = z.object({
  csrfToken: z.string().min(40).max(50),
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

export const CsrfResponseSchema = z.object({
  csrfToken: z.string().min(40).max(50),
});

export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    emailNormalized: z.string().email(),
    timezone: z.literal("Asia/Manila"),
    currency: z.literal("PHP"),
    theme: z.enum(["system", "light", "dark"]),
    hideBalances: z.boolean(),
  }),
  serverToday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  onboardingStatus: z.enum(["NEEDS_FIRST_ACCOUNT", "READY"]),
});

export const PreferencesPatchRequestSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    hideBalances: z.boolean().optional(),
  })
  .strict();

export const PreferencesResponseSchema = z.object({
  preferences: z.object({
    timezone: z.literal("Asia/Manila"),
    currency: z.literal("PHP"),
    theme: z.enum(["system", "light", "dark"]),
    hideBalances: z.boolean(),
  }),
});

export const FinancialAccountTypeSchema = z.enum([
  "CASH",
  "BANK",
  "EWALLET",
  "CREDIT_CARD",
]);

const MinorUnitsStringSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/);

export const FinancialAccountCreateRequestBaseSchema = z
  .object({
    type: FinancialAccountTypeSchema,
    name: z.string().trim().min(1).max(80),
    institution: z.string().trim().min(1).max(120).optional(),
    openingBalanceMinor: MinorUnitsStringSchema,
    creditLimitMinor: MinorUnitsStringSchema.optional(),
    statementDay: z.number().int().min(1).max(31).optional(),
    dueDay: z.number().int().min(1).max(31).optional(),
  })
  .strict();

export const FinancialAccountCreateRequestSchema =
  FinancialAccountCreateRequestBaseSchema.superRefine((account, context) => {
    const maxBigInt = 9_223_372_036_854_775_807n;
    if (BigInt(account.openingBalanceMinor) > maxBigInt) {
      context.addIssue({
        code: "custom",
        message: "Opening balance exceeds PostgreSQL BIGINT range.",
        path: ["openingBalanceMinor"],
      });
    }
    if (
      account.creditLimitMinor !== undefined &&
      (BigInt(account.creditLimitMinor) === 0n ||
        BigInt(account.creditLimitMinor) > maxBigInt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Credit limit must be positive and fit PostgreSQL BIGINT.",
        path: ["creditLimitMinor"],
      });
    }
    if (
      account.type !== "CREDIT_CARD" &&
      (account.creditLimitMinor !== undefined ||
        account.statementDay !== undefined ||
        account.dueDay !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Credit card details are only valid for credit card accounts.",
        path: ["type"],
      });
    }
  });

export type FinancialAccountCreateRequest = z.infer<
  typeof FinancialAccountCreateRequestSchema
>;

export const FinancialAccountPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const FinancialAccountSchema = z.object({
  id: z.string().uuid(),
  type: FinancialAccountTypeSchema,
  name: z.string(),
  institution: z.string().nullable(),
  currency: z.literal("PHP"),
  balanceMinor: z.string().regex(/^-?\d+$/),
  sortOrder: z.number().int(),
  creditLimitMinor: z.string().nullable(),
  statementDay: z.number().int().nullable(),
  dueDay: z.number().int().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const FinancialAccountsResponseSchema = z.object({
  accounts: z.array(FinancialAccountSchema),
});

export const FinancialAccountResponseSchema = z.object({
  account: FinancialAccountSchema,
});

export const CategoryKindSchema = z.enum(["INCOME", "EXPENSE"]);

export const CategoryIconSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

export const CategoryCreateRequestSchema = z
  .object({
    kind: CategoryKindSchema,
    name: z.string().trim().min(1).max(60),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    icon: CategoryIconSchema.optional(),
  })
  .strict();

export const CategoryPatchRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    icon: CategoryIconSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const CategorySchema = z.object({
  id: z.string().uuid(),
  kind: CategoryKindSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  icon: CategoryIconSchema.nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const CategoriesResponseSchema = z.object({
  categories: z.array(CategorySchema),
});

export const CategoryResponseSchema = z.object({
  category: CategorySchema,
});

export type CategoryCreateRequest = z.infer<typeof CategoryCreateRequestSchema>;
export type CategoryPatchRequest = z.infer<typeof CategoryPatchRequestSchema>;
export type CategoryRecord = z.infer<typeof CategorySchema>;

export const TransactionKindSchema = z.enum([
  "OPENING_BALANCE",
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "REFUND",
  "ADJUSTMENT",
  "CARD_PAYMENT",
]);
const IncomeExpenseKindSchema = z.enum(["INCOME", "EXPENSE"]);
const maxPostgresBigInt = 9_223_372_036_854_775_807n;

function addPositiveMinorUnitIssues(
  value: string,
  path: (string | number)[],
  context: z.RefinementCtx,
) {
  if (BigInt(value) === 0n) {
    context.addIssue({
      code: "custom",
      message: "Amount must be positive.",
      path,
    });
  } else if (BigInt(value) > maxPostgresBigInt) {
    context.addIssue({
      code: "custom",
      message: "Amount exceeds PostgreSQL BIGINT range.",
      path,
    });
  }
}

export const TransferCreateRequestSchema = z
  .object({
    kind: z.literal("TRANSFER"),
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amountMinor: MinorUnitsStringSchema,
    feeMinor: MinorUnitsStringSchema.optional(),
    feeCategoryId: z.string().uuid().optional(),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
    acknowledgeNegativeBalance: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    addPositiveMinorUnitIssues(request.amountMinor, ["amountMinor"], context);
    if (
      request.feeMinor !== undefined &&
      BigInt(request.feeMinor) > maxPostgresBigInt
    ) {
      context.addIssue({
        code: "custom",
        message: "Fee exceeds PostgreSQL BIGINT range.",
        path: ["feeMinor"],
      });
    }
    const fee = request.feeMinor === undefined ? 0n : BigInt(request.feeMinor);
    if (fee > 0n && request.feeCategoryId === undefined) {
      context.addIssue({
        code: "custom",
        message: "A fee category is required when a transfer fee is positive.",
        path: ["feeCategoryId"],
      });
    }
    if (fee === 0n && request.feeCategoryId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A fee category requires a positive transfer fee.",
        path: ["feeMinor"],
      });
    }
  });

export const RefundCreateRequestSchema = z
  .object({
    kind: z.literal("REFUND"),
    sourceAccountId: z.string().uuid(),
    refundedTransactionId: z.string().uuid(),
    amountMinor: MinorUnitsStringSchema,
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    addPositiveMinorUnitIssues(request.amountMinor, ["amountMinor"], context);
  });

export const AdjustmentCreateRequestSchema = z
  .object({
    kind: z.literal("ADJUSTMENT"),
    accountId: z.string().uuid(),
    direction: z.enum(["INCREASE", "DECREASE"]),
    amountMinor: MinorUnitsStringSchema,
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
    acknowledgeNegativeBalance: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    addPositiveMinorUnitIssues(request.amountMinor, ["amountMinor"], context);
  });

export const TransactionCreateRequestSchema = z
  .object({
    kind: IncomeExpenseKindSchema,
    sourceAccountId: z.string().uuid(),
    categoryId: z.string().uuid(),
    amountMinor: MinorUnitsStringSchema,
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
    acknowledgeNegativeBalance: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const maxBigInt = 9_223_372_036_854_775_807n;
    if (BigInt(request.amountMinor) === 0n) {
      context.addIssue({
        code: "custom",
        message: "Amount must be positive.",
        path: ["amountMinor"],
      });
    } else if (BigInt(request.amountMinor) > maxBigInt) {
      context.addIssue({
        code: "custom",
        message: "Amount exceeds PostgreSQL BIGINT range.",
        path: ["amountMinor"],
      });
    }
  });

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  kind: TransactionKindSchema,
  status: z.enum(["POSTED", "VOID"]),
  currentRevision: z.number().int().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().uuid().nullable(),
  refundedTransactionId: z.string().uuid().nullable(),
  note: z.string().nullable(),
});

export const TransactionCreateResponseSchema = z.object({
  transaction: TransactionSchema,
  account: FinancialAccountSchema,
});

export const TransferCreateResponseSchema = z.object({
  transaction: TransactionSchema,
  sourceAccount: FinancialAccountSchema,
  destinationAccount: FinancialAccountSchema,
});

export const TransactionRequestSchema = z.union([
  TransactionCreateRequestSchema,
  TransferCreateRequestSchema,
  RefundCreateRequestSchema,
  AdjustmentCreateRequestSchema,
]);

export const TransactionEditRequestSchema = z.intersection(
  TransactionCreateRequestSchema,
  z.object({ reason: z.string().trim().min(1).max(300) }).strict(),
);

export const TransactionDeleteRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(300) })
  .strict();

export const TransactionResponseSchema = z.object({
  transaction: TransactionSchema,
});

export const TransactionAuditEntrySchema = z.object({
  version: z.number().int().positive(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const TransactionAuditResponseSchema = z.object({
  transaction: TransactionSchema,
  revisions: z.array(TransactionAuditEntrySchema),
});

export type TransactionCreateRequest = z.infer<
  typeof TransactionCreateRequestSchema
>;
export type TransferCreateRequest = z.infer<typeof TransferCreateRequestSchema>;
export type RefundCreateRequest = z.infer<typeof RefundCreateRequestSchema>;
export type AdjustmentCreateRequest = z.infer<
  typeof AdjustmentCreateRequestSchema
>;
export type TransactionEditRequest = z.infer<
  typeof TransactionEditRequestSchema
>;
export type TransactionDeleteRequest = z.infer<
  typeof TransactionDeleteRequestSchema
>;
export type TransactionRequest = z.infer<typeof TransactionRequestSchema>;
export type TransactionRecord = z.infer<typeof TransactionSchema>;

export const AuthSessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});

export const SessionsResponseSchema = z.object({
  sessions: z.array(AuthSessionSchema),
});

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      "VALIDATION_ERROR",
      "REQUEST_ERROR",
      "NOT_FOUND",
      "CONFLICT",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "RATE_LIMITED",
      "UNAVAILABLE",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    requestId: z.string(),
    details: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
