import { createHash } from "node:crypto";
import { shapedError } from "./errors.js";

const KEY = /^.{1,100}$/su;

/**
 * Хук Fastify для POST (ADR-0035): перевіряє заголовок Idempotency-Key і кладе
 * ключ, хеш запиту й статус успіху маршруту в контекст. Далі ключем керує
 * unitOfWork у шарі даних — роут транзакцій не бачить.
 * Статус успіху маршрут задає в `config.successStatus` (типово 200).
 * @param {import("./context.js").Context} context
 */
export function idempotencyHook(context) {
  /**
   * @param {import("fastify").FastifyRequest} request
   * @returns {Promise<void>}
   */
  return async function (request) {
    if (request.method !== "POST") return;
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !KEY.test(key)) {
      throw shapedError(
        "VALIDATION_FAILED",
        400,
        "POST вимагає заголовок Idempotency-Key (1–100 символів)",
      );
    }
    const config = /** @type {{ successStatus?: number }} */ (
      request.routeOptions.config
    );
    context.current().idempotency = {
      key,
      requestHash: createHash("sha256")
        .update(`${request.method} ${request.url}\n`)
        .update(JSON.stringify(request.body ?? null))
        .digest("hex"),
      successStatus: config.successStatus ?? 200,
    };
  };
}
