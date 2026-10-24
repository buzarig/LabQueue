// PostgreSQL для LabQueue (ADR-0032): пул із fail-fast на старті (ADR-0034),
// бекенд unitOfWork із повторами (ADR-0030, ADR-0034, ADR-0035), доступ
// репозиторіїв до поточної транзакції. Драйвер імпортується лише тут і в
// repo-pg.js модулів (ADR-0031).
import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { KEY_TTL_MS } from "../unit-of-work.js";
import { isBrokenConnection, isTransient, translateDbError } from "./errors.js";

const MAX_RETRIES = 3;
const BACKOFF_MS = [50, 100, 200];

/** @typedef {import("postgres").Sql} Sql */
/** @typedef {import("postgres").ReservedSql} ReservedSql */

/** Транзакція PostgreSQL у контексті запиту. */
class PgTx {
  /** @param {ReservedSql} sql */
  constructor(sql) {
    this.sql = sql;
  }
}

/** @param {string} url */
function redact(url) {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = "***";
  return parsed.href;
}

/**
 * Пул і явна перевірка `select now()` на старті: без БД — помилка одразу
 * (ADR-0034). Колонки snake_case ↔ поля camelCase — у драйвері.
 * `onQuery` бачить кожен SQL-запит — для лічильника N+1 у звіті (К16).
 * @param {string} url
 * @param {{ onQuery?: (query: string) => void }} [options]
 * @returns {Promise<Sql>}
 */
export async function connectDb(url, { onQuery } = {}) {
  const sql = postgres(url, {
    ...(onQuery ? { debug: (_id, query) => onQuery(query) } : {}),
    max: 10,
    connect_timeout: 2,
    idle_timeout: 30,
    connection: { statement_timeout: 3000, application_name: "labqueue" },
    onnotice: () => {},
    transform: postgres.camel,
  });
  try {
    await sql`select now()`;
  } catch (error) {
    await sql.end({ timeout: 0 });
    const code = /** @type {{ code?: string }} */ (error).code ?? String(error);
    throw new Error(`БД недоступна: ${redact(url)} (${code})`, {
      cause: error,
    });
  }
  return sql;
}

/**
 * Доступ репозиторіїв до БД: читання — через поточну транзакцію або пул,
 * запис — лише в unitOfWork (ADR-0030).
 * @param {{ sql: Sql, context: import("../context.js").Context }} deps
 */
export function createDbAccess({ sql, context }) {
  return {
    /** @returns {Sql | ReservedSql} */
    read() {
      const tx = context.peek()?.tx;
      return tx instanceof PgTx ? tx.sql : sql;
    },
    /** @returns {ReservedSql} */
    write() {
      const tx = context.peek()?.tx;
      if (!(tx instanceof PgTx)) throw new Error("запис поза unitOfWork");
      return tx.sql;
    },
  };
}

/** @typedef {ReturnType<typeof createDbAccess>} DbAccess */

/**
 * Готовність (`GET /ready`): `select 1` за 1 с.
 * @param {Sql} sql
 */
export function readiness(sql) {
  return async () => {
    try {
      await Promise.race([
        sql`select 1`,
        sleep(1000).then(() => Promise.reject(new Error("timeout"))),
      ]);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * Бекенд unitOfWork для PostgreSQL. Тимчасові помилки — повтор цілої
 * транзакції до 3 разів (50 → 100 → 200 мс ± 25 %); далі й для інших збоїв
 * джерела — доменна помилка для глобального обробника.
 * @param {{
 *   sql: Sql,
 *   context: import("../context.js").Context,
 *   onRetry?: (info: { attempt: number, code: string }) => void,
 * }} deps
 */
export function createPgBackend({ sql, context, onRetry = () => {} }) {
  /**
   * Одна спроба транзакції на зарезервованому з'єднанні (ADR-0036). Не
   * sql.begin: той після будь-якої помилки шле rollback тим самим з'єднанням,
   * і на обірваному postgres.js 3.4.9 валить процес записом у закритий
   * сокет. Тут обірване з'єднання не отримує ні rollback (сервер відкотить
   * сам), ні повернення в пул — драйвер перепідключить його.
   * @template T
   * @param {(tx: import("../unit-of-work.js").UnitTx) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function once(fn) {
    const store = context.current();
    const conn = await sql.reserve();
    let healthy = true;
    try {
      await conn`begin`;
      store.tx = new PgTx(conn);
      const result = await fn(unitTx(conn));
      await conn`commit`;
      return result;
    } catch (error) {
      healthy = !isBrokenConnection(error);
      if (healthy) await conn`rollback`;
      throw error;
    } finally {
      store.tx = undefined;
      if (healthy) conn.release();
    }
  }

  return {
    /**
     * @template T
     * @param {(tx: import("../unit-of-work.js").UnitTx) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async transaction(fn) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await once(fn);
        } catch (error) {
          if (attempt < MAX_RETRIES && isTransient(error)) {
            const code = /** @type {{ code?: string }} */ (error).code ?? "";
            onRetry({ attempt: attempt + 1, code });
            await sleep(BACKOFF_MS[attempt] * (0.75 + Math.random() * 0.5));
            continue;
          }
          throw translateDbError(error);
        }
      }
    },
  };
}

/**
 * @param {ReservedSql} tx
 * @returns {import("../unit-of-work.js").UnitTx}
 */
function unitTx(tx) {
  let savepoints = 0;
  return {
    async withSavepoint(inner) {
      const name = tx(`s${(savepoints += 1)}`);
      await tx`savepoint ${name}`;
      try {
        const result = await inner();
        await tx`release savepoint ${name}`;
        return result;
      } catch (error) {
        if (!isBrokenConnection(error)) {
          await tx`rollback to savepoint ${name}`;
        }
        throw error;
      }
    },
    async claimKey(userId, key, requestHash, now) {
      // Другий запит із тим самим ключем чекає тут на унікальному індексі,
      // доки перша транзакція не завершиться (data.md, «Ідемпотентність»).
      const [inserted] = await tx`
        insert into platform.idempotency_keys (user_id, key, request_hash, created_at)
        values (${userId}, ${key}, ${requestHash}, ${now})
        on conflict (user_id, key) do nothing
        returning key`;
      if (inserted) return undefined;
      const [row] = await tx`
        select request_hash, result_status, result_body, created_at
        from platform.idempotency_keys
        where user_id = ${userId} and key = ${key}
        for update`;
      if (now.getTime() - row.createdAt.getTime() >= KEY_TTL_MS) {
        await tx`
          update platform.idempotency_keys
          set request_hash = ${requestHash}, result_status = null,
              result_body = null, created_at = ${now}
          where user_id = ${userId} and key = ${key}`;
        return undefined;
      }
      return {
        userId,
        key,
        requestHash: row.requestHash,
        resultStatus: row.resultStatus,
        resultBody: row.resultBody,
        createdAt: row.createdAt,
      };
    },
    async completeKey(userId, key, status, body) {
      await tx`
        update platform.idempotency_keys
        set result_status = ${status},
            result_body = ${tx.json(/** @type {any} */ (body ?? null))}
        where user_id = ${userId} and key = ${key}`;
    },
  };
}
