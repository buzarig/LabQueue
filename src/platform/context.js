import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Користувач-ініціатор запиту. Кладе його identity (ADR-0030).
 * @typedef {{ id: string, role: "student" | "teacher", groupId: string | null }} ContextUser
 */

/**
 * Ключ ідемпотентності поточного POST (ADR-0035).
 * @typedef {{ key: string, requestHash: string, successStatus: number }} ContextIdempotency
 */

/**
 * Контекст одного запиту: усе, що інакше довелося б протягувати параметрами.
 * `tx` — поточна транзакція; її кладе й прибирає лише unitOfWork.
 * @typedef {{
 *   processId: string,
 *   user?: ContextUser,
 *   idempotency?: ContextIdempotency,
 *   tx?: unknown,
 * }} RequestStore
 */

/**
 * Контекст запиту в AsyncLocalStorage (ADR-0030). main.js створює один на
 * застосунок і передає модулям; модулі не імпортують platform.
 */
export function createContext() {
  /** @type {AsyncLocalStorage<RequestStore>} */
  const als = new AsyncLocalStorage();
  return {
    /**
     * Запускає `fn` у новому контексті.
     * @template T
     * @param {RequestStore} store
     * @param {() => T} fn
     * @returns {T}
     */
    run(store, fn) {
      return als.run(store, fn);
    },
    /**
     * Поточний контекст. Поза запитом — помилка: виклик без контексту не має
     * тихо працювати повз транзакцію чи без processId.
     * @returns {RequestStore}
     */
    current() {
      const store = als.getStore();
      if (!store) throw new Error("context.current() поза запитом");
      return store;
    },
    /**
     * Контекст, якщо він є (для логера, який пише й поза запитами).
     * @returns {RequestStore | undefined}
     */
    peek() {
      return als.getStore();
    },
  };
}

/** @typedef {ReturnType<typeof createContext>} Context */
