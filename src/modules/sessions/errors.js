// Помилки sessions за формою { code, statusCode } (ADR-0031, data.md «Каталог помилок»).

/**
 * @param {string} code
 * @param {number} statusCode
 * @param {string} message
 */
function domainError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

export const sessionNotFound = () =>
  domainError("SESSION_NOT_FOUND", 404, "Немає такого заняття");

export const notSessionOwner = () =>
  domainError("NOT_SESSION_OWNER", 403, "Заняття веде інший викладач");

/** @param {string} detail */
export const unknownReference = (detail) =>
  domainError("UNKNOWN_REFERENCE", 422, detail);

/**
 * @param {string} from
 * @param {string} to
 */
export const sessionStateConflict = (from, to) =>
  domainError(
    "SESSION_STATE_CONFLICT",
    409,
    `Заняття не можна перевести зі стану ${from} у ${to}`,
  );
