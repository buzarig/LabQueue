import { createKeyedMutex } from "./keyed-mutex.js";
import { KEY_TTL_MS } from "./unit-of-work.js";

/**
 * Сховище статики (ADR-0027): таблиці в пам'яті, транзакції з м'ютексом за
 * викладачем і undo-журналом (промпт 039). Кожна транзакція відкочує лише
 * власні записи, тож відкат не затирає змін паралельної транзакції іншого
 * викладача.
 */

/** @typedef {import("./unit-of-work.js").IdempotencyRecord} IdempotencyRecord */
/** @typedef {import("./unit-of-work.js").UnitTx} UnitTx */

const IDEMPOTENCY_TABLE = "platform.idempotency_keys";

/** @typedef {Map<string, unknown>} Rows */

class MemoryTx {
  /** @type {Array<{ rows: Rows, id: string, had: boolean, before: unknown }>} */
  journal = [];
  /** @type {Map<string, () => void>} */
  releases = new Map();

  /** @param {Rows} rows @param {string} id */
  record(rows, id) {
    this.journal.push({ rows, id, had: rows.has(id), before: rows.get(id) });
  }

  /** @param {number} mark */
  rollbackTo(mark) {
    while (this.journal.length > mark) {
      const entry = /** @type {(typeof this.journal)[number]} */ (
        this.journal.pop()
      );
      if (entry.had) entry.rows.set(entry.id, entry.before);
      else entry.rows.delete(entry.id);
    }
  }

  /**
   * Захоплює ключ до кінця транзакції; повторне захоплення — без очікування.
   * @param {ReturnType<typeof createKeyedMutex>} mutex
   * @param {string} key
   */
  async lock(mutex, key) {
    if (this.releases.has(key)) return;
    this.releases.set(key, await mutex.acquire(key));
  }

  releaseAll() {
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }
}

/**
 * @param {{ context: import("./context.js").Context }} deps
 */
export function createMemoryStore({ context }) {
  /** @type {Map<string, Rows>} */
  const tables = new Map();
  const teacherLocks = createKeyedMutex();
  const keyLocks = createKeyedMutex();

  /** @returns {MemoryTx} */
  function currentTx() {
    const tx = context.current().tx;
    if (!(tx instanceof MemoryTx)) {
      throw new Error("запис поза unitOfWork");
    }
    return tx;
  }

  /** @param {string} name @returns {Rows} */
  function rowsOf(name) {
    let rows = tables.get(name);
    if (!rows) {
      rows = new Map();
      tables.set(name, rows);
    }
    return rows;
  }

  /**
   * Таблиця модуля. Читання — будь-коли, запис — лише в unitOfWork.
   * Рядки копіюються на вході й виході, тож змінити їх повз журнал неможливо.
   * @template T
   * @param {string} name `<схема>.<таблиця>`, як у data.md
   */
  function table(name) {
    const rows = rowsOf(name);
    return {
      /** @param {string} id @returns {T | undefined} */
      get(id) {
        const row = rows.get(id);
        return row === undefined
          ? undefined
          : structuredClone(/** @type {T} */ (row));
      },
      /** @returns {T[]} */
      all() {
        return [...rows.values()].map((row) =>
          structuredClone(/** @type {T} */ (row)),
        );
      },
      /** @param {string} id @param {T} row */
      put(id, row) {
        currentTx().record(rows, id);
        rows.set(id, structuredClone(row));
      },
      /** @param {string} id */
      remove(id) {
        currentTx().record(rows, id);
        rows.delete(id);
      },
      /**
       * Seed і очищення поза транзакцією — лише для старту й тестів.
       * @param {Array<[string, T]>} entries
       */
      seed(entries) {
        rows.clear();
        for (const [id, row] of entries) rows.set(id, structuredClone(row));
      },
    };
  }

  const idempotency = table(IDEMPOTENCY_TABLE);

  return {
    table,

    /**
     * Блокування за викладачем (ADR-0022): перша дія змінювальної команди
     * після того, як відомо заняття. Тримається до кінця транзакції.
     * @param {string} teacherId
     */
    async lockTeacher(teacherId) {
      await currentTx().lock(teacherLocks, `teacher:${teacherId}`);
    },

    /**
     * Транзакція для unitOfWork: коміт — відкинути журнал, відкат — програти
     * журнал назад. Блокування звільняються в кінці в обох випадках.
     * @template T
     * @param {(tx: UnitTx) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async transaction(fn) {
      const tx = new MemoryTx();
      /** @type {UnitTx} */
      const unit = {
        async withSavepoint(inner) {
          const mark = tx.journal.length;
          try {
            return await inner();
          } catch (error) {
            tx.rollbackTo(mark);
            throw error;
          }
        },
        async claimKey(userId, key, requestHash, now) {
          await tx.lock(keyLocks, `idempotency:${userId}:${key}`);
          const id = `${userId}\u0000${key}`;
          const existing = /** @type {IdempotencyRecord | undefined} */ (
            idempotency.get(id)
          );
          if (
            existing &&
            now.getTime() - existing.createdAt.getTime() < KEY_TTL_MS
          ) {
            return existing;
          }
          idempotency.put(id, {
            userId,
            key,
            requestHash,
            resultStatus: null,
            resultBody: null,
            createdAt: now,
          });
          return undefined;
        },
        async completeKey(userId, key, status, body) {
          const id = `${userId}\u0000${key}`;
          const row = /** @type {IdempotencyRecord} */ (idempotency.get(id));
          idempotency.put(id, {
            ...row,
            resultStatus: status,
            resultBody: body,
          });
        },
      };
      const store = context.current();
      store.tx = tx;
      try {
        const result = await fn(unit);
        tx.journal = [];
        return result;
      } catch (error) {
        tx.rollbackTo(0);
        throw error;
      } finally {
        store.tx = undefined;
        tx.releaseAll();
      }
    },
  };
}

/** @typedef {ReturnType<typeof createMemoryStore>} MemoryStore */
