import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { HealthResponseSchema } from "@monikey/contracts";
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
app.get(
  "/healthz",
  { schema: { tags: ["system"], summary: "Process liveness" } },
  async () => ({
    status: "ok",
  }),
);

app.get(
  "/api/v1/health",
  {
    schema: {
      tags: ["system"],
      summary: "API and database readiness",
      response: {
        200: z.toJSONSchema(HealthResponseSchema),
        503: z.toJSONSchema(HealthResponseSchema),
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
