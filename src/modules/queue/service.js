// Сервіс queue (ADR-0031): записи черги, виклик, прийом, результат, неявки
// (architecture.md, S5–S8, S10; інваріанти I1–I9). Кожна змінювальна команда
// — один unitOfWork під блокуванням за викладачем заняття (ADR-0022);
// доменні відмови — всередині, щоб ключ ідемпотентності зберіг і їх (ADR-0035).
import { randomUUID } from "node:crypto";
import {
  alreadyInQueue,
  droppedFromSession,
  enrollmentClosed,
  entryNotFound,
  entryStateConflict,
  labNotAccepted,
  notInGroup,
  notSessionOwner,
  queueEmpty,
  queueLimitReached,
  scoreMismatch,
  sessionNotFound,
  teacherBusy,
} from "./errors.js";

/** @typedef {import("./model.js").Entry} Entry */
/** @typedef {import("./model.js").EntryStatus} EntryStatus */

/** Друга неявка — «вибув» (I7, ADR-0003). */
const MAX_NO_SHOWS = 2;

/**
 * @param {{
 *   repo: import("./repo.js").QueueRepo,
 *   identity: import("../identity/index.js").IdentityApi,
 *   sessions: import("../sessions/index.js").SessionsApi,
 *   unitOfWork: import("../../platform/unit-of-work.js").UnitOfWork,
 *   clock: { now: () => Date },
 * }} deps
 */
export function createQueueService({
  repo,
  identity,
  sessions,
  unitOfWork,
  clock,
}) {
  const now = () => clock.now().toISOString();

  /**
   * Заняття, яким керує поточний викладач: 404 → 403 (data.md).
   * @param {string} sessionId
   */
  async function ownedSession(sessionId) {
    const session = await sessions.getById(sessionId);
    if (!session) throw sessionNotFound();
    const teacher = identity.requireRole("teacher");
    if (session.teacherId !== teacher.id) throw notSessionOwner();
    return session;
  }

  /**
   * Запис, яким керує поточний викладач, під блокуванням за ним; після
   * блокування читається ще раз. Ключ блокування — з самого запису (ADR-0029).
   * @param {string} entryId
   * @param {EntryStatus} expected
   * @param {EntryStatus} target для повідомлення про конфлікт
   * @returns {Promise<Entry>}
   */
  async function ownedEntryLocked(entryId, expected, target) {
    const entry = await repo.findEntry(entryId);
    if (!entry) throw entryNotFound();
    const teacher = identity.requireRole("teacher");
    if (entry.teacherId !== teacher.id) throw notSessionOwner();
    await repo.lockTeacher(entry.teacherId);
    const fresh = /** @type {Entry} */ (await repo.findEntry(entryId));
    if (fresh.status !== expected) {
      throw entryStateConflict(fresh.status, target);
    }
    return fresh;
  }

  /**
   * @param {Entry} entry
   * @param {Partial<Entry>} change
   */
  async function save(entry, change) {
    const updated = { ...entry, ...change };
    await repo.updateEntry(updated);
    return updated;
  }

  return {
    /**
     * S10. Студент стає в чергу в кінець (I6 разом з I1, I2; I3 через seq).
     * @param {string} sessionId
     * @param {string} labId
     * @returns {Promise<Entry>}
     */
    enqueue(sessionId, labId) {
      return unitOfWork(async () => {
        const known = await sessions.getById(sessionId);
        if (!known) throw sessionNotFound();
        const student = identity.requireRole("student");
        if (student.groupId !== known.groupId) throw notInGroup();
        await repo.lockTeacher(known.teacherId);
        const session = /** @type {typeof known} */ (
          await sessions.getById(sessionId)
        );
        if (session.state !== "open") throw enrollmentClosed();
        if (!session.labIds.includes(labId)) throw labNotAccepted();
        if ((await repo.noShowCount(sessionId, student.id)) >= MAX_NO_SHOWS) {
          throw droppedFromSession();
        }
        if (await repo.activeOfStudent(sessionId, student.id)) {
          throw alreadyInQueue();
        }
        if ((await repo.countActive(sessionId)) >= session.queueLimit) {
          throw queueLimitReached();
        }
        /** @type {Entry} */
        const entry = {
          id: randomUUID(),
          sessionId,
          teacherId: session.teacherId,
          studentId: student.id,
          labId,
          status: "waiting",
          seq: (await repo.maxSeq(sessionId)) + 1,
          enqueuedAt: now(),
          calledAt: null,
          startedAt: null,
          finishedAt: null,
          score: null,
        };
        await repo.insertEntry(entry);
        return entry;
      });
    },

    /**
     * S5. Викликати першого за seq. I4: у викладача немає called/submitting
     * на жодному його занятті.
     * @param {string} sessionId
     */
    callNext(sessionId) {
      return unitOfWork(async () => {
        const session = await ownedSession(sessionId);
        await repo.lockTeacher(session.teacherId);
        if (await repo.teacherBusy(session.teacherId)) throw teacherBusy();
        const next = await repo.firstWaiting(sessionId);
        if (!next) throw queueEmpty();
        return save(next, { status: "called", calledAt: now() });
      });
    },

    /**
     * S6. Почати прийом: called → submitting (sf-17).
     * @param {string} entryId
     */
    start(entryId) {
      return unitOfWork(async () => {
        const entry = await ownedEntryLocked(entryId, "called", "submitting");
        return save(entry, { status: "submitting", startedAt: now() });
      });
    },

    /**
     * S7. Результат: submitting → passed (бал 0–100) | rework (без балу), I9.
     * @param {string} entryId
     * @param {import("./model.js").Result} result
     */
    result(entryId, { outcome, score }) {
      return unitOfWork(async () => {
        const entry = await ownedEntryLocked(entryId, "submitting", outcome);
        if (outcome === "passed" && score === undefined) {
          throw scoreMismatch("«Зараховано» вимагає бал 0–100");
        }
        if (outcome === "rework" && score !== undefined) {
          throw scoreMismatch("«На доопрацювання» без балу");
        }
        return save(entry, {
          status: outcome,
          score: outcome === "passed" ? /** @type {number} */ (score) : null,
          finishedAt: now(),
        });
      });
    },

    /**
     * S8. Неявка лише з called (sf-8): перша — у кінець черги, друга — «вибув».
     * Лічильник — на пару (студент, заняття), не на запис (ADR-0003).
     * @param {string} entryId
     * @returns {Promise<{ entry: Entry, noShowCount: number }>}
     */
    noShow(entryId) {
      return unitOfWork(async () => {
        const entry = await ownedEntryLocked(entryId, "called", "waiting");
        const count = await repo.addNoShow(entry.sessionId, entry.studentId);
        const updated =
          count >= MAX_NO_SHOWS
            ? await save(entry, { status: "dropped", finishedAt: now() })
            : await save(entry, {
                status: "waiting",
                seq: (await repo.maxSeq(entry.sessionId)) + 1,
              });
        return { entry: updated, noShowCount: count };
      });
    },
  };
}

/** @typedef {ReturnType<typeof createQueueService>} QueueService */
