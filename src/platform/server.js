import { randomUUID } from "node:crypto";
import Fastify from "fastify";
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
 * }} options
 */
export function createServer({ sha, context, logger = true, logStream }) {
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

  app.setErrorHandler((error, request, reply) => {
    const response = toErrorResponse(error);
    if (response.unexpected) {
      request.log.error({ err: error }, "непередбачена помилка");
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

  app.get(
    "/version",
    {
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
