import Fastify from "fastify";
import type { FastifyError } from "fastify";
import swagger from "@fastify/swagger";
import {
  ApiErrorResponseSchema,
  EchoRequestSchema,
  EchoResponseSchema,
  HealthResponseSchema,
} from "@monikey/contracts";
import { Pool } from "pg";
import { z } from "zod";

const port = Number(process.env.API_PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : undefined;
const app = Fastify({ logger: true, trustProxy: false });

await app.register(swagger, {
  openapi: {
    openapi: "3.1.0",
    info: { title: "MoniKey V2 API", version: "0.1.0" },
    servers: [{ url: "/api/v1" }],
  },
});

app.setErrorHandler((error: FastifyError, request, reply) => {
  if (error.validation) {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        requestId: request.id,
        details: error.validation.map((issue) => ({
          path: issue.instancePath || "/",
          message: issue.message ?? "Invalid value",
        })),
      },
    });
  }

  const statusCode =
    error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
  if (statusCode >= 500) request.log.error(error);

  return reply.code(statusCode).send({
    error: {
      code:
        statusCode === 404
          ? "NOT_FOUND"
          : statusCode === 409
            ? "CONFLICT"
            : statusCode < 500
              ? "REQUEST_ERROR"
              : "INTERNAL_ERROR",
      message:
        statusCode === 404
          ? "The requested resource was not found."
          : statusCode >= 500
            ? "An unexpected error occurred."
            : error.message,
      requestId: request.id,
    },
  });
});

app.setNotFoundHandler((request, reply) =>
  reply.code(404).send({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      requestId: request.id,
    },
  }),
);
app.get("/healthz", { schema: { hide: true } }, async () => ({
  status: "ok",
}));

if (process.env.NODE_ENV !== "production") {
  app.post(
    "/api/v1/diagnostics/echo",
    {
      schema: {
        tags: ["system"],
        summary: "Development-only request contract probe",
        body: z.toJSONSchema(EchoRequestSchema, { target: "draft-7" }),
        response: {
          200: z.toJSONSchema(EchoResponseSchema, { target: "draft-7" }),
          400: z.toJSONSchema(ApiErrorResponseSchema, { target: "draft-7" }),
        },
      },
    },
    async (request) => request.body,
  );
}

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
  async (_request, reply) => {
    let database: "connected" | "unconfigured" | "unavailable" = "unconfigured";
    if (pool) {
      try {
        await pool.query("SELECT 1");
        database = "connected";
      } catch {
        database = "unavailable";
      }
    }

    if (database === "unavailable") {
      return reply.code(503).send({ status: "degraded", database });
    }
    return { status: "ok", database };
  },
);

app.get("/openapi.json", async () => app.swagger());

app.addHook("onClose", async () => {
  await pool?.end();
});

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
