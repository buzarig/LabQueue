// Помилки identity за формою { code, statusCode } (ADR-0031, data.md «Каталог помилок»).

/**
 * @param {string} code
 * @param {number} statusCode
 * @param {string} message
 */
function domainError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

export const unauthenticated = () =>
  domainError(
    "UNAUTHENTICATED",
    401,
    "Немає X-User-Id або користувач невідомий",
  );

/** @param {string} role */
export const forbiddenRole = (role) =>
  domainError("FORBIDDEN_ROLE", 403, `Дія доступна лише ролі ${role}`);
