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
});

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
