/**
 * Помилка за формою, яку розпізнає глобальний обробник (ADR-0031): модуль
 * кидає її зі свого errors.js, платформа не знає класів модулів.
 * @typedef {Error & { code: string, statusCode: number }} ShapedError
 */

const DOMAIN_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Доменна (очікувана) помилка: код з каталогу data.md і статус 4xx або 503.
 * Помилки самого Fastify (`FST_…`) сюди не входять.
 * @param {unknown} error
 * @returns {error is ShapedError}
 */
export function isDomainError(error) {
  if (!(error instanceof Error)) return false;
  const { code, statusCode } = /** @type {Partial<ShapedError>} */ (error);
  return (
    typeof code === "string" &&
    DOMAIN_CODE.test(code) &&
    !code.startsWith("FST_") &&
    typeof statusCode === "number" &&
    ((statusCode >= 400 && statusCode < 500) || statusCode === 503)
  );
}

/**
 * Створює помилку потрібної форми. Для коду самої платформи; модулі мають
 * власні errors.js з тією ж формою.
 * @param {string} code
 * @param {number} statusCode
 * @param {string} message
 * @returns {ShapedError}
 */
export function shapedError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

/**
 * Перетворює будь-яку помилку на HTTP-відповідь у форматі data.md:
 * `{ error: { code, message } }`. Деталі непередбачених помилок — лише в лог.
 * @param {unknown} error
 * @returns {{ status: number, body: { error: { code: string, message: string } }, unexpected: boolean }}
 */
export function toErrorResponse(error) {
  const fastifyError =
    /** @type {{ validation?: unknown, code?: unknown, statusCode?: unknown, message?: unknown }} */ (
      error ?? {}
    );
  if (fastifyError.validation) {
    return reply(400, "VALIDATION_FAILED", String(fastifyError.message));
  }
  if (isDomainError(error)) {
    return reply(error.statusCode, error.code, error.message);
  }
  const status = Number(fastifyError.statusCode);
  if (
    typeof fastifyError.code === "string" &&
    fastifyError.code.startsWith("FST_") &&
    status >= 400 &&
    status < 500
  ) {
    return reply(status, "VALIDATION_FAILED", String(fastifyError.message));
  }
  return {
    ...reply(500, "INTERNAL", "Внутрішня помилка сервера"),
    unexpected: true,
  };
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function reply(status, code, message) {
  return { status, body: { error: { code, message } }, unexpected: false };
}
