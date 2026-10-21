import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["connected", "unconfigured", "unavailable"]),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
