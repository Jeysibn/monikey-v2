import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  HealthLiveResponseSchema,
  HealthResponseSchema,
} from "@monikey/contracts";
import { z } from "zod";

type DatabaseHealth = "connected" | "unconfigured" | "unavailable";

async function checkDatabaseHealth(
  pool: Pool | undefined,
): Promise<DatabaseHealth> {
  if (!pool) return "unconfigured";
  try {
    await pool.query("SELECT 1");
    return "connected";
  } catch {
    return "unavailable";
  }
}

export function registerHealthRoutes(
  app: FastifyInstance,
  databaseHealthPool: Pool | undefined,
): void {
  // Process-only probe. Keep it independent of PostgreSQL so orchestration can
  // distinguish a live process from one that is ready to serve financial API.
  app.get("/healthz", { schema: { hide: true } }, async () => ({
    status: "ok",
  }));

  const readiness = async (_request: FastifyRequest, reply: FastifyReply) => {
    const database = await checkDatabaseHealth(databaseHealthPool);
    if (database !== "connected") {
      return reply.code(503).send({ status: "degraded", database });
    }
    return { status: "ok", database };
  };

  app.get(
    "/api/v1/health",
    {
      schema: {
        tags: ["system"],
        summary: "API and database readiness",
        response: {
          200: z.toJSONSchema(HealthResponseSchema, { target: "draft-7" }),
          503: z.toJSONSchema(HealthResponseSchema, { target: "draft-7" }),
        },
      },
    },
    readiness,
  );

  app.get(
    "/api/v1/health/live",
    {
      schema: {
        tags: ["system"],
        summary: "Process liveness without database inspection",
        response: {
          200: z.toJSONSchema(HealthLiveResponseSchema, { target: "draft-7" }),
        },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/api/v1/health/ready",
    {
      schema: {
        tags: ["system"],
        summary: "API and database readiness",
        response: {
          200: z.toJSONSchema(HealthResponseSchema, { target: "draft-7" }),
          503: z.toJSONSchema(HealthResponseSchema, { target: "draft-7" }),
        },
      },
    },
    readiness,
  );
}
