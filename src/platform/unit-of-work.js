import { isDomainError, shapedError } from "./errors.js";

/** Ключ ідемпотентності діє 24 години (data.md, «Ідемпотентність»). */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Рядок ідемпотентності (data.md, «Схема БД», platform.idempotency_keys).
 * @typedef {{
 *   userId: string,
 *   key: string,
 *   requestHash: string,
 *   resultStatus: number | null,
 *   resultBody: unknown,
 *   createdAt: Date,
 * }} IdempotencyRecord
 */

/**
 * Транзакція, яку бачить unitOfWork; однаковий контракт для пам'яті й
 * PostgreSQL.
 * @typedef {{
 *   withSavepoint: <T>(fn: () => Promise<T>) => Promise<T>,
 *   claimKey: (userId: string, key: string, requestHash: string, now: Date) => Promise<IdempotencyRecord | undefined>,
 *   completeKey: (userId: string, key: string, status: number, body: unknown) => Promise<void>,
 * }} UnitTx
 */

/**
 * unitOfWork (ADR-0030, ADR-0035): сервіс позначає ним межу транзакції й не
 * бачить ні BEGIN, ні SQL. Тут же — ідемпотентність: ключ із контексту
 * запиту, результат сервісу пишеться в тій самій транзакції.
 *
 * Бекенд дає `transaction(fn)`: пам'ять зараз, PostgreSQL — пізніше.
 * @param {{
 *   context: import("./context.js").Context,
 *   clock: import("./clock.js").Clock,
 *   backend: { transaction: <T>(fn: (tx: UnitTx) => Promise<T>) => Promise<T> },
 * }} deps
 */
export function createUnitOfWork({ context, clock, backend }) {
  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  return async function unitOfWork(fn) {
    const store = context.current();
    if (store.tx) throw new Error("вкладений unitOfWork");
    const idempotency = store.idempotency;
    const userId = store.user?.id;
    if (idempotency && !userId) {
      throw new Error("ідемпотентність без користувача-ініціатора");
    }

    // Доменна відмова з ключем має закомітитися, тож із транзакції вона
    // виходить як результат і кидається вже після коміту.
    const outcome = await backend.transaction(async (tx) => {
      if (idempotency && userId) {
        const existing = await tx.claimKey(
          userId,
          idempotency.key,
          idempotency.requestHash,
          clock.now(),
        );
        if (existing) {
          if (existing.requestHash !== idempotency.requestHash) {
            throw shapedError(
              "IDEMPOTENCY_KEY_REUSED",
              409,
              "Ключ ідемпотентності вже використано з іншим запитом",
            );
          }
          return replay(existing);
        }
      }

      /** @type {Outcome<T>} */
      let outcome;
      try {
        outcome = { value: await tx.withSavepoint(fn) };
      } catch (error) {
        // Доменна відмова відкочує лише savepoint, а ключ із нею комітиться;
        // будь-що інше відкочує всю транзакцію, і повтор спробує знову.
        if (!idempotency || !isDomainError(error)) throw error;
        outcome = { error };
      }

      if (idempotency && userId) {
        if ("error" in outcome) {
          const { code, message, statusCode } = outcome.error;
          await tx.completeKey(userId, idempotency.key, statusCode, {
            code,
            message,
          });
        } else {
          await tx.completeKey(
            userId,
            idempotency.key,
            idempotency.successStatus,
            outcome.value,
          );
        }
      }
      return outcome;
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  };
}

/**
 * @template T
 * @typedef {{ value: T } | { error: import("./errors.js").ShapedError }} Outcome
 */

/**
 * Повтор: та сама доменна відмова або те саме значення, без виклику сервісу.
 * @param {IdempotencyRecord} record
 * @returns {Outcome<any>}
 */
function replay(record) {
  if (record.resultStatus !== null && record.resultStatus >= 400) {
    const body = /** @type {{ code: string, message: string }} */ (
      record.resultBody
    );
    return { error: shapedError(body.code, record.resultStatus, body.message) };
  }
  return { value: record.resultBody };
}

/** @typedef {ReturnType<typeof createUnitOfWork>} UnitOfWork */
