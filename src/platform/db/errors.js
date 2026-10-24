// Класифікація збоїв джерела (ADR-0034, data.md «Збої джерела»). Лише коди —
// без драйвера, тож глобальний обробник помилок теж може нею користуватися.
import { shapedError } from "../errors.js";

/** Повторюються цілою транзакцією: конфлікт, дедлок, обрив з'єднання. */
const TRANSIENT = new Set([
  "40001",
  "40P01",
  "57P01",
  "ECONNRESET",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

/** Одразу 503: сервер недоступний, таймаут підключення чи запиту. */
const UNAVAILABLE = new Set([
  "ECONNREFUSED",
  "CONNECT_TIMEOUT",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "57014",
  "57P03",
]);

/** @param {unknown} error */
const codeOf = (error) =>
  typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";

/**
 * Тимчасова помилка: транзакцію варто повторити.
 * @param {unknown} error
 */
export function isTransient(error) {
  const code = codeOf(error);
  return TRANSIENT.has(code) || /^08[0-9A-Z]{3}$/.test(code);
}

/**
 * З'єднання мертве: після такої помилки в нього не можна нічого писати
 * (postgres.js 3.4.9 падає на записі в закритий сокет, ADR-0036).
 * @param {unknown} error
 */
export function isBrokenConnection(error) {
  const code = codeOf(error);
  return (
    code === "ECONNRESET" ||
    code === "57P01" ||
    code.startsWith("CONNECTION_") ||
    /^08[0-9A-Z]{3}$/.test(code)
  );
}

/**
 * Помилка БД → доменна форма для глобального обробника або сама помилка,
 * якщо до джерела вона не стосується (тоді — 500 INTERNAL).
 * Тимчасова тут означає «повтори вичерпано» або «повтор неможливий».
 * @param {unknown} error
 * @returns {unknown}
 */
export function translateDbError(error) {
  const code = codeOf(error);
  if (UNAVAILABLE.has(code) || isTransient(error)) {
    return Object.assign(
      shapedError(
        "SOURCE_UNAVAILABLE",
        503,
        "Джерело даних тимчасово недоступне",
      ),
      { retryAfter: 1, cause: error },
    );
  }
  if (code === "23505") {
    // Друга лінія спрацювала — це помилка коду, а не користувача (ADR-0002).
    return Object.assign(
      shapedError("CONFLICT", 409, "Конфлікт даних, спробуйте ще раз"),
      { logAsError: true, cause: error },
    );
  }
  return error;
}
