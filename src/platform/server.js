import Fastify from "fastify";

/**
 * HTTP-сервер з технічними ендпоінтами (К8). Доменні модулі реєструються
 * як плагіни в main.js (ADR-0009).
 * @param {{ sha: string, logger?: boolean }} options
 */
export function createServer({ sha, logger = true }) {
  const app = Fastify({ logger });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: { status: { type: "string", const: "ok" } },
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
