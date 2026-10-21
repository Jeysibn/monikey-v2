import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["connected", "unconfigured", "unavailable"]),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      "VALIDATION_ERROR",
      "REQUEST_ERROR",
      "NOT_FOUND",
      "CONFLICT",
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

export const EchoRequestSchema = z
  .object({ message: z.string().min(1).max(160) })
  .strict();
export const EchoResponseSchema = z.object({ message: z.string() });
export type EchoRequest = z.infer<typeof EchoRequestSchema>;
export type EchoResponse = z.infer<typeof EchoResponseSchema>;
