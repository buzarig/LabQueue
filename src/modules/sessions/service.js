// Сервіс sessions (ADR-0031): заняття, стан запису, право власника
// (architecture.md, S1–S3; завершення S4 координує queue, ADR-0005).
// Кожна змінювальна команда — один unitOfWork; доменні відмови — всередині,
// щоб ключ ідемпотентності зберіг і їх (ADR-0035).
import { randomUUID } from "node:crypto";
import {
  notSessionOwner,
  sessionNotFound,
  sessionStateConflict,
  unknownReference,
} from "./errors.js";

/** @typedef {import("./model.js").Session} Session */
/** @typedef {import("./model.js").SessionState} SessionState */

/**
 * @param {{
 *   repo: import("./repo.js").SessionsRepo,
 *   identity: import("../identity/index.js").IdentityApi,
 *   catalog: import("../catalog/index.js").CatalogApi,
 *   unitOfWork: import("../../platform/unit-of-work.js").UnitOfWork,
 * }} deps
 */
export function createSessionsService({ repo, identity, catalog, unitOfWork }) {
  /**
   * Заняття, яким керує поточний викладач, під блокуванням за ним (ADR-0022).
   * Порядок відмов: 404 → 403 (data.md, «Каталог помилок»). Після блокування
   * заняття читається ще раз: стан міг змінитися, поки ми чекали.
   * @param {string} id
   * @returns {Promise<Session>}
   */
  async function ownedSessionLocked(id) {
    const session = await repo.findById(id);
    if (!session) throw sessionNotFound();
    const teacher = identity.requireRole("teacher");
    if (session.teacherId !== teacher.id) throw notSessionOwner();
    await repo.lockTeacher(session.teacherId);
    return /** @type {Session} */ (await repo.findById(id));
  }

  /**
   * Перехід стану за діаграмою (architecture.md, «Стани» → Session).
   * @param {Session} session
   * @param {SessionState[]} from
   * @param {SessionState} to
   * @returns {Promise<Session>}
   */
  async function transition(session, from, to) {
    if (!from.includes(session.state)) {
      throw sessionStateConflict(session.state, to);
    }
    await repo.updateState(session.id, to);
    return { ...session, state: to };
  }

  return {
    /**
     * S1. Викладач створює заняття. Предмет, група й лаби мають існувати, а
     * лаби — належати предмету заняття (422 UNKNOWN_REFERENCE).
     * @param {import("./model.js").NewSession} input
     * @returns {Promise<Session>}
     */
    create(input) {
      return unitOfWork(async () => {
        const teacher = identity.requireRole("teacher");
        const [subjects, groups, labs] = await Promise.all([
          catalog.subjectsByIds([input.subjectId]),
          catalog.groupsByIds([input.groupId]),
          catalog.labsByIds(input.labIds),
        ]);
        if (subjects.length === 0) throw unknownReference("Невідомий предмет");
        if (groups.length === 0) throw unknownReference("Невідома група");
        if (labs.length !== input.labIds.length) {
          throw unknownReference("Невідома лаба");
        }
        if (labs.some((lab) => lab.subjectId !== input.subjectId)) {
          throw unknownReference("Лаба не з предмета заняття");
        }
        await repo.lockTeacher(teacher.id);
        /** @type {Session} */
        const session = {
          id: randomUUID(),
          subjectId: input.subjectId,
          groupId: input.groupId,
          teacherId: teacher.id,
          startsAt: new Date(input.startsAt).toISOString(),
          room: input.room,
          queueLimit: input.queueLimit,
          state: "planned",
          labIds: [...input.labIds].sort(),
        };
        await repo.insert(session);
        return session;
      });
    },

    /**
     * S2. Відкрити запис: planned | closed → open.
     * @param {string} id
     */
    open(id) {
      return unitOfWork(async () =>
        transition(await ownedSessionLocked(id), ["planned", "closed"], "open"),
      );
    },

    /**
     * S3. Закрити запис: open → closed. Черга при цьому не змінюється.
     * @param {string} id
     */
    close(id) {
      return unitOfWork(async () =>
        transition(await ownedSessionLocked(id), ["open"], "closed"),
      );
    },

    /**
     * Завершення заняття (S4): closed → finished. Лише для queue (ADR-0005),
     * у його транзакції: власника й «немає здає» queue вже перевірив, а
     * заняття щойно перечитав під блокуванням — читати вдруге не треба (К16).
     * @param {Session} session
     */
    async markFinished(session) {
      return transition(session, ["closed"], "finished");
    },

    /** @param {string} id */
    getById: (id) => repo.findById(id),
    /** @param {string[]} ids */
    getByIds: (ids) => repo.findByIds(ids),
    /** @param {string} groupId */
    getByGroup: (groupId) => repo.findByGroup(groupId),
  };
}

/** @typedef {ReturnType<typeof createSessionsService>} SessionsService */
