import Fastify from "fastify";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  ApiErrorResponseSchema,
  ChangePasswordRequestSchema,
  CsrfResponseSchema,
  FinancialAccountCreateRequestBaseSchema,
  FinancialAccountCreateRequestSchema,
  FinancialAccountPatchRequestSchema,
  FinancialAccountResponseSchema,
  FinancialAccountsResponseSchema,
  HealthResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
  PreferencesPatchRequestSchema,
  PreferencesResponseSchema,
  SessionsResponseSchema,
} from "@monikey/contracts";
import {
  archiveFinancialAccount,
  createFinancialAccount,
  listFinancialAccounts,
  readFinancialAccount,
  updateFinancialAccount,
} from "./accounts.js";
import { runIdempotently } from "./idempotency.js";
import argon2 from "argon2";
import type { HashOptions } from "argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { z } from "zod";

const port = Number(process.env.API_PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : undefined;
const app = Fastify({ logger: true, trustProxy: false });
const sessionCookie = "__Host-mk_session";
const csrfCookie = "__Host-mk_csrf";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
const configuredOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";
const expectedOrigin = new URL(configuredOrigin).origin;
if (expectedOrigin !== configuredOrigin) {
  throw new Error(
    "APP_ORIGIN must be an exact origin without a path or trailing slash.",
  );
}
const argon2Options: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const dummyPasswordHash = await argon2.hash(randomBytes(32), argon2Options);
const apiErrorJsonSchema = z.toJSONSchema(ApiErrorResponseSchema, {
  target: "draft-7",
});
const authErrorResponses = () => ({
  400: apiErrorJsonSchema,
  401: apiErrorJsonSchema,
  403: apiErrorJsonSchema,
  404: apiErrorJsonSchema,
  409: apiErrorJsonSchema,
  429: apiErrorJsonSchema,
  500: apiErrorJsonSchema,
  503: apiErrorJsonSchema,
});

type AuthContext = {
  sessionId: string;
  userId: string;
  csrfTokenHash: string;
};

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

app.decorateRequest("authContext", null);

await app.register(swagger, {
  openapi: {
    openapi: "3.1.0",
    info: { title: "MoniKey V2 API", version: "0.1.0" },
    servers: [{ url: "/api/v1" }],
  },
});

await app.register(cookie);
await app.register(rateLimit, {
  global: false,
  errorResponseBuilder: (request) => ({
    statusCode: 429,
    message: "Too many sign-in attempts. Try again later.",
    error: {
      code: "RATE_LIMITED",
      message: "Too many sign-in attempts. Try again later.",
      requestId: request.id,
    },
  }),
});

app.addHook("onSend", (request, reply, _payload, done) => {
  if (
    request.url.startsWith("/api/v1/auth/") ||
    request.url.startsWith("/api/v1/me") ||
    request.url.startsWith("/api/v1/accounts")
  ) {
    reply.header("Cache-Control", "no-store");
  }
  done();
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
            : statusCode === 401
              ? "UNAUTHENTICATED"
              : statusCode === 403
                ? "FORBIDDEN"
                : statusCode === 429
                  ? "RATE_LIMITED"
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serverTodayInManila(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function ownerUserId(request: FastifyRequest): string {
  const ownerId = request.authContext?.userId;
  if (!ownerId) throw new Error("Authenticated owner scope is required.");
  return ownerId;
}

async function withDatabaseTransaction<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!pool) throw new Error("Database is not configured.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withDatabaseConnection<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!pool) throw new Error("Database is not configured.");
  const client = await pool.connect();
  try {
    return await action(client);
  } finally {
    client.release();
  }
}

function safeHashEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function mutationOriginIsValid(request: {
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];
  return (
    origin === expectedOrigin &&
    (fetchSite === undefined || fetchSite === "same-origin")
  );
}

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const token = request.cookies[sessionCookie];
  if (!pool || !token) {
    reply.code(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in is required.",
        requestId: request.id,
      },
    });
    return false;
  }

  const result = await pool.query<AuthContext>(
    `SELECT s.id AS "sessionId", s.user_id AS "userId", s.csrf_token_hash AS "csrfTokenHash"
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'ACTIVE'`,
    [sha256(token)],
  );
  const session = result.rows[0];
  if (!session) {
    reply.code(401).send({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in is required.",
        requestId: request.id,
      },
    });
    return false;
  }
  request.authContext = session;
  await pool.query(
    "UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1",
    [session.sessionId],
  );
  return true;
}

function requireMutationOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (mutationOriginIsValid(request)) return true;
  reply.code(403).send({
    error: {
      code: "FORBIDDEN",
      message: "The request origin is not allowed.",
      requestId: request.id,
    },
  });
  return false;
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers["x-csrf-token"];
  const expected = request.authContext?.csrfTokenHash;
  if (
    typeof token === "string" &&
    expected &&
    safeHashEqual(sha256(token), expected)
  ) {
    return true;
  }
  reply.code(403).send({
    error: {
      code: "FORBIDDEN",
      message: "A valid CSRF token is required.",
      requestId: request.id,
    },
  });
  return false;
}

function requiredIdempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply,
): string | undefined {
  const key = request.headers["idempotency-key"];
  if (typeof key === "string" && /^[\w.:~-]{16,200}$/.test(key)) return key;
  reply.code(400).send({
    error: {
      code: "VALIDATION_ERROR",
      message: "A valid Idempotency-Key header is required.",
      requestId: request.id,
    },
  });
  return undefined;
}

const idempotencyHeaderSchema = {
  type: "object",
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": { type: "string", minLength: 16, maxLength: 200 },
  },
};

app.post(
  "/api/v1/auth/login",
  {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "15 minutes",
        hook: "preValidation",
        keyGenerator: (request) => {
          const body = request.body as { email?: unknown } | undefined;
          const email =
            typeof body?.email === "string"
              ? body.email.trim().toLowerCase()
              : "";
          return `${request.ip}:${sha256(email)}`;
        },
      },
    },
    schema: {
      tags: ["identity"],
      summary: "Sign in to the private owner account",
      body: z.toJSONSchema(LoginRequestSchema, { target: "draft-7" }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(LoginResponseSchema, { target: "draft-7" }),
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!pool)
      return reply.code(503).send({
        error: {
          code: "UNAVAILABLE",
          message: "Authentication storage is unavailable.",
          requestId: request.id,
        },
      });

    const { email, password } = LoginRequestSchema.parse(request.body);
    const result = await pool.query<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE email_normalized = $1 AND status = 'ACTIVE'",
      [email.toLowerCase()],
    );
    const user = result.rows[0];
    // Always perform an Argon2 verification to reduce account-enumeration timing differences.
    const passwordMatches = await argon2
      .verify(user?.password_hash ?? dummyPasswordHash, password)
      .catch(() => false);
    if (!user || !passwordMatches) {
      return reply.code(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Email or password is incorrect.",
          requestId: request.id,
        },
      });
    }

    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const previousToken = request.cookies[sessionCookie];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (previousToken) {
        await client.query(
          "UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
          [sha256(previousToken)],
        );
      }
      await client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, csrf_token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '14 days')`,
        [
          user.id,
          sha256(token),
          sha256(csrfToken),
          request.headers["user-agent"] ?? null,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    reply.setCookie(sessionCookie, token, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: sessionMaxAgeSeconds,
    });
    reply.setCookie(csrfCookie, csrfToken, {
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: sessionMaxAgeSeconds,
    });
    reply.header("Cache-Control", "no-store");
    return reply.code(200).send({ csrfToken });
  },
);

app.get(
  "/api/v1/auth/csrf",
  {
    schema: {
      tags: ["identity"],
      summary: "Recover the current session CSRF token",
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(CsrfResponseSchema, { target: "draft-7" }),
      },
    },
  },
  async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    let csrfToken = request.cookies[csrfCookie];
    if (
      !csrfToken ||
      !safeHashEqual(sha256(csrfToken), request.authContext!.csrfTokenHash)
    ) {
      csrfToken = randomBytes(32).toString("base64url");
      await pool!.query(
        "UPDATE auth_sessions SET csrf_token_hash = $1 WHERE id = $2",
        [sha256(csrfToken), request.authContext!.sessionId],
      );
      reply.setCookie(csrfCookie, csrfToken, {
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        maxAge: sessionMaxAgeSeconds,
      });
    }
    reply.header("Cache-Control", "no-store");
    return { csrfToken };
  },
);

app.post(
  "/api/v1/auth/change-password",
  {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    schema: {
      tags: ["identity"],
      summary: "Change the password and rotate this session",
      body: z.toJSONSchema(ChangePasswordRequestSchema, { target: "draft-7" }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(CsrfResponseSchema, { target: "draft-7" }),
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;

    const { currentPassword, newPassword } = ChangePasswordRequestSchema.parse(
      request.body,
    );
    const userResult = await pool!.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1 AND status = 'ACTIVE'",
      [ownerUserId(request)],
    );
    const user = userResult.rows[0];
    const matches = user
      ? await argon2
          .verify(user.password_hash, currentPassword)
          .catch(() => false)
      : false;
    if (!user || !matches) {
      return reply.code(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "The current password is incorrect.",
          requestId: request.id,
        },
      });
    }

    const passwordHash = await argon2.hash(newPassword, argon2Options);
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
        [passwordHash, ownerUserId(request)],
      );
      await client.query(
        "UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        [ownerUserId(request), request.authContext!.sessionId],
      );
      await client.query(
        `UPDATE auth_sessions
            SET token_hash = $1, csrf_token_hash = $2, created_at = now(),
                expires_at = now() + interval '14 days', last_seen_at = now()
          WHERE id = $3`,
        [sha256(token), sha256(csrfToken), request.authContext!.sessionId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    reply.setCookie(sessionCookie, token, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: sessionMaxAgeSeconds,
    });
    reply.setCookie(csrfCookie, csrfToken, {
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: sessionMaxAgeSeconds,
    });
    reply.header("Cache-Control", "no-store");
    return { csrfToken };
  },
);

app.get(
  "/api/v1/me",
  {
    schema: {
      tags: ["identity"],
      summary: "Read the signed-in owner profile",
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(MeResponseSchema, { target: "draft-7" }),
      },
    },
  },
  async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const result = await pool!.query<{
      id: string;
      emailNormalized: string;
      timezone: string;
      currency: string;
      theme: string;
      hideBalances: boolean;
      hasAccounts: boolean;
    }>(
      `SELECT u.id, u.email_normalized AS "emailNormalized", p.timezone, p.currency, p.theme,
              p.hide_balances AS "hideBalances",
              EXISTS (SELECT 1 FROM financial_accounts a WHERE a.user_id = u.id) AS "hasAccounts"
         FROM users u JOIN user_preferences p ON p.user_id = u.id
        WHERE u.id = $1`,
      [ownerUserId(request)],
    );
    reply.header("Cache-Control", "no-store");
    return {
      user: result.rows[0],
      serverToday: serverTodayInManila(),
      onboardingStatus: result.rows[0]!.hasAccounts
        ? ("READY" as const)
        : ("NEEDS_FIRST_ACCOUNT" as const),
    };
  },
);

app.patch(
  "/api/v1/me/preferences",
  {
    schema: {
      tags: ["identity"],
      summary: "Update the signed-in owner's theme and privacy preferences",
      body: z.toJSONSchema(PreferencesPatchRequestSchema, {
        target: "draft-7",
      }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(PreferencesResponseSchema, { target: "draft-7" }),
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;

    const patch = PreferencesPatchRequestSchema.parse(request.body);
    if (patch.theme === undefined && patch.hideBalances === undefined) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide at least one preference to update.",
          requestId: request.id,
        },
      });
    }
    const result = await pool!.query<{
      timezone: string;
      currency: string;
      theme: string;
      hideBalances: boolean;
    }>(
      `UPDATE user_preferences
          SET theme = COALESCE($2, theme),
              hide_balances = COALESCE($3, hide_balances),
              updated_at = now()
        WHERE user_id = $1
        RETURNING timezone, currency, theme, hide_balances AS "hideBalances"`,
      [ownerUserId(request), patch.theme ?? null, patch.hideBalances ?? null],
    );
    if (!result.rows[0]) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "The requested preferences were not found.",
          requestId: request.id,
        },
      });
    }
    return { preferences: result.rows[0] };
  },
);

const AccountParamsSchema = z.object({ accountId: z.string().uuid() });
const AccountListQuerySchema = z
  .object({ includeArchived: z.enum(["true", "false"]).optional() })
  .strict();

app.get(
  "/api/v1/accounts",
  {
    schema: {
      tags: ["accounts"],
      summary: "List the signed-in owner's financial accounts and balances",
      querystring: z.toJSONSchema(AccountListQuerySchema, {
        target: "draft-7",
      }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(FinancialAccountsResponseSchema, {
          target: "draft-7",
        }),
      },
    },
  },
  async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const query = AccountListQuerySchema.parse(request.query);
    const accounts = await withDatabaseConnection((client) =>
      listFinancialAccounts(
        client,
        ownerUserId(request),
        query.includeArchived === "true",
      ),
    );
    return { accounts };
  },
);

app.post(
  "/api/v1/accounts",
  {
    schema: {
      tags: ["accounts"],
      summary: "Create a financial account with its opening balance",
      headers: idempotencyHeaderSchema,
      body: z.toJSONSchema(FinancialAccountCreateRequestBaseSchema, {
        target: "draft-7",
      }),
      response: {
        ...authErrorResponses(),
        201: z.toJSONSchema(FinancialAccountResponseSchema, {
          target: "draft-7",
        }),
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;
    const key = requiredIdempotencyKey(request, reply);
    if (!key) return;
    const parsedBody = FinancialAccountCreateRequestSchema.safeParse(
      request.body,
    );
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          requestId: request.id,
          details: parsedBody.error.issues.map((issue) => ({
            path: `/${issue.path.join("/")}`,
            message: issue.message,
          })),
        },
      });
    }
    const body = parsedBody.data;
    const result = await withDatabaseTransaction((client) =>
      runIdempotently(client, ownerUserId(request), key, body, async () => ({
        account: await createFinancialAccount(
          client,
          ownerUserId(request),
          body,
          serverTodayInManila(),
        ),
      })),
    );
    return reply.code(201).send(result.value);
  },
);

app.get(
  "/api/v1/accounts/:accountId",
  {
    schema: {
      tags: ["accounts"],
      summary: "Read an account and its ledger-derived balance",
      params: z.toJSONSchema(AccountParamsSchema, { target: "draft-7" }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(FinancialAccountResponseSchema, {
          target: "draft-7",
        }),
      },
    },
  },
  async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const { accountId } = AccountParamsSchema.parse(request.params);
    const account = await withDatabaseConnection((client) =>
      readFinancialAccount(client, ownerUserId(request), accountId),
    );
    return { account };
  },
);

app.patch(
  "/api/v1/accounts/:accountId",
  {
    schema: {
      tags: ["accounts"],
      summary: "Rename or reorder an active financial account",
      headers: idempotencyHeaderSchema,
      params: z.toJSONSchema(AccountParamsSchema, { target: "draft-7" }),
      body: z.toJSONSchema(FinancialAccountPatchRequestSchema, {
        target: "draft-7",
      }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(FinancialAccountResponseSchema, {
          target: "draft-7",
        }),
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;
    const key = requiredIdempotencyKey(request, reply);
    if (!key) return;
    const { accountId } = AccountParamsSchema.parse(request.params);
    const body = FinancialAccountPatchRequestSchema.parse(request.body);
    if (body.name === undefined && body.sortOrder === undefined) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide a name or sort order to update.",
          requestId: request.id,
        },
      });
    }
    const result = await withDatabaseTransaction((client) =>
      runIdempotently(
        client,
        ownerUserId(request),
        key,
        { accountId, ...body },
        async () => ({
          account: await updateFinancialAccount(
            client,
            ownerUserId(request),
            accountId,
            {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.sortOrder !== undefined
                ? { sortOrder: body.sortOrder }
                : {}),
            },
          ),
        }),
      ),
    );
    return result.value;
  },
);

app.post(
  "/api/v1/accounts/:accountId/archive",
  {
    schema: {
      tags: ["accounts"],
      summary: "Archive an account without deleting its history",
      headers: idempotencyHeaderSchema,
      params: z.toJSONSchema(AccountParamsSchema, { target: "draft-7" }),
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(FinancialAccountResponseSchema, {
          target: "draft-7",
        }),
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;
    const key = requiredIdempotencyKey(request, reply);
    if (!key) return;
    const { accountId } = AccountParamsSchema.parse(request.params);
    const result = await withDatabaseTransaction((client) =>
      runIdempotently(
        client,
        ownerUserId(request),
        key,
        { accountId, action: "archive" },
        async () => ({
          account: await archiveFinancialAccount(
            client,
            ownerUserId(request),
            accountId,
          ),
        }),
      ),
    );
    return result.value;
  },
);

app.get(
  "/api/v1/auth/sessions",
  {
    schema: {
      tags: ["identity"],
      summary: "List this owner's active sessions",
      response: {
        ...authErrorResponses(),
        200: z.toJSONSchema(SessionsResponseSchema, { target: "draft-7" }),
      },
    },
  },
  async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const sessions = await pool!.query(
      `SELECT id, created_at AS "createdAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt", user_agent AS "userAgent",
              (id = $2) AS "current"
         FROM auth_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC`,
      [ownerUserId(request), request.authContext!.sessionId],
    );
    reply.header("Cache-Control", "no-store");
    return { sessions: sessions.rows };
  },
);

app.delete(
  "/api/v1/auth/sessions/:sessionId",
  {
    schema: {
      tags: ["identity"],
      summary: "Revoke one of this owner's sessions",
      params: z.toJSONSchema(z.object({ sessionId: z.string().uuid() }), {
        target: "draft-7",
      }),
      response: {
        ...authErrorResponses(),
        204: { type: "null" },
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;
    const params = request.params as { sessionId: string };
    const result = await pool!.query(
      `UPDATE auth_sessions SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [params.sessionId, ownerUserId(request)],
    );
    if (result.rowCount === 0) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "The requested session was not found.",
          requestId: request.id,
        },
      });
    }
    if (params.sessionId === request.authContext!.sessionId) {
      reply.clearCookie(sessionCookie, {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      reply.clearCookie(csrfCookie, {
        path: "/",
        secure: true,
        sameSite: "lax",
      });
    }
    return reply.code(204).send();
  },
);

app.post(
  "/api/v1/auth/logout",
  {
    schema: {
      tags: ["identity"],
      summary: "Revoke the current session",
      response: {
        ...authErrorResponses(),
        204: { type: "null" },
      },
    },
  },
  async (request, reply) => {
    if (!requireMutationOrigin(request, reply)) return;
    if (!(await requireSession(request, reply))) return;
    if (!requireCsrf(request, reply)) return;
    await pool!.query(
      "UPDATE auth_sessions SET revoked_at = now() WHERE id = $1",
      [request.authContext!.sessionId],
    );
    reply.clearCookie(sessionCookie, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    reply.clearCookie(csrfCookie, { path: "/", secure: true, sameSite: "lax" });
    return reply.code(204).send();
  },
);

app.addHook("onClose", async () => {
  await pool?.end();
});

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
