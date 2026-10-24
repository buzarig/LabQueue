import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { translateDbError } from "./db/errors.js";
import { toErrorResponse } from "./errors.js";
import { idempotencyHook } from "./idempotency.js";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * processId запиту (ADR-0030): X-Request-Id від клієнта, якщо він безпечний
 * для логів, інакше новий UUID.
 * @param {{ headers: Record<string, string | string[] | undefined> }} request
 */
function processIdOf(request) {
  const header = request.headers["x-request-id"];
  return typeof header === "string" && REQUEST_ID.test(header)
    ? header
    : randomUUID();
}

/**
 * HTTP-сервер з технічними ендпоінтами (К8 лаби 1), контекстом запиту,
 * processId у кожному лозі й одним глобальним обробником помилок
 * (ADR-0030, ADR-0031). Доменні модулі реєструються як плагіни в main.js.
 * @param {{
 *   sha: string,
 *   context: import("./context.js").Context,
 *   logger?: boolean,
 *   logStream?: { write: (line: string) => void },
 *   ready?: () => Promise<boolean>,
 * }} options
 */
export function createServer({
  sha,
  context,
  logger = true,
  logStream,
  ready = async () => true,
}) {
  const app = Fastify({
    genReqId: processIdOf,
    // Невідомі поля в тілі — 400, а не тихе видалення (data.md); типи не
    // перетворюються: "5" замість 5 — теж помилка валідації.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    logger: logger && {
      // processId і користувач — у кожному лозі з будь-якого рівня, без
      // участі коду, що логує (ADR-0030).
      mixin() {
        const store = context.peek();
        return store
          ? { processId: store.processId, userId: store.user?.id }
          : {};
      },
      ...(logStream ? { stream: logStream } : {}),
    },
  });

  // Контекст живе від onRequest до кінця обробки; run(…, done) переносить
  // його на всі наступні хуки й обробник.
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    context.run({ processId: request.id }, done);
  });

  // Після автентифікації (onRequest) і до валідації тіла: 401 → 400 (data.md).
  app.addHook("preValidation", idempotencyHook(context));

  // Один обробник для всього застосунку (К6): доменні помилки, валідація,
  // збої БД (503 з Retry-After, ADR-0034) і непередбачені (500).
  app.setErrorHandler((error, request, reply) => {
    const translated =
      /** @type {{ retryAfter?: number, logAsError?: boolean }} */ (
        translateDbError(error)
      );
    const response = toErrorResponse(translated);
    if (response.unexpected) {
      request.log.error({ err: error }, "непередбачена помилка");
    } else if (translated.logAsError) {
      request.log.error({ err: error }, "спрацювала друга лінія БД");
    }
    if (translated.retryAfter) {
      reply.header("retry-after", String(translated.retryAfter));
    }
    return reply.code(response.status).send(response.body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `Немає маршруту ${request.method} ${request.url}`,
      },
    }),
  );

  app.get(
    "/health",
    {
      config: { public: true },
      schema: {
        response: {
          200: {
            type: "object",
            properties: { status: { type: "string" } },
            required: ["status"],
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  // Готовність: чи працює джерело даних (ADR-0034). /health — лише «процес живий».
  app.get("/ready", { config: { public: true } }, async (request, reply) =>
    (await ready())
      ? { status: "ready" }
      : reply.code(503).send({ status: "unavailable" }),
  );

  app.get(
    "/version",
    {
      config: { public: true },
      schema: {
        response: {
          200: {
            type: "object",
            properties: { sha: { type: "string" } },
            required: ["sha"],
          },
        },
      },
    },
    async () => ({ sha }),
  );

  return app;
}
