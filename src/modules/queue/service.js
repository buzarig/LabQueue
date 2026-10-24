// Сервіс queue (ADR-0031): записи черги, виклик, прийом, результат, неявки,
// завершення заняття, стан черг, позиція, вихід, історія (architecture.md,
// S4–S13; інваріанти I1–I11). Кожна змінювальна команда
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
  noActiveEntry,
  notEntryOwner,
  notInGroup,
  notSessionOwner,
  queueEmpty,
  queueLimitReached,
  scoreMismatch,
  sessionNotFound,
  sessionStateConflict,
  submittingInProgress,
  teacherBusy,
} from "./errors.js";

/** @typedef {import("./model.js").Entry} Entry */
/** @typedef {import("./model.js").EntryStatus} EntryStatus */

/** Друга неявка — «вибув» (I7, ADR-0003). */
const MAX_NO_SHOWS = 2;

/** Орієнтовний час: останні 5 здач заняття, без них — 10 хв (sf-19 лаби 1). */
const ETA_SAMPLE = 5;
const ETA_DEFAULT_MINUTES = 10;

/**
 * @param {{
 *   repo: import("./repo.js").QueueRepo,
 *   identity: import("../identity/index.js").IdentityApi,
 *   sessions: import("../sessions/index.js").SessionsApi,
 *   catalog: import("../catalog/index.js").CatalogApi,
 *   unitOfWork: import("../../platform/unit-of-work.js").UnitOfWork,
 *   clock: { now: () => Date },
 * }} deps
 */
export function createQueueService({
  repo,
  identity,
  sessions,
  catalog,
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
   * Заняття групи поточного студента: 404 → 403 (I6, I11).
   * @param {string} sessionId
   */
  async function sessionOfMyGroup(sessionId) {
    const session = await sessions.getById(sessionId);
    if (!session) throw sessionNotFound();
    const student = identity.requireRole("student");
    if (student.groupId !== session.groupId) throw notInGroup();
    return { session, student };
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
     * S4. Завершити заняття (ADR-0005): лише з closed і без submitting (I10,
     * sf-18); waiting і called → missed; заняття → finished. Одна транзакція.
     * @param {string} sessionId
     */
    finish(sessionId) {
      return unitOfWork(async () => {
        const known = await ownedSession(sessionId);
        await repo.lockTeacher(known.teacherId);
        const session = /** @type {typeof known} */ (
          await sessions.getById(sessionId)
        );
        if (session.state !== "closed") {
          throw sessionStateConflict(session.state, "finished");
        }
        if (await repo.hasSubmitting(sessionId)) throw submittingInProgress();
        const missedCount = await repo.missActive(sessionId, now());
        const finished = await sessions.markFinished(session);
        return { ...finished, missedCount };
      });
    },

    /**
     * S9. Заняття групи студента зі станом черг. Зведення — одним викликом
     * для всіх занять, без запиту на кожне (К16).
     */
    async listForStudent() {
      const student = identity.requireRole("student");
      const list = await sessions.getByGroup(
        /** @type {string} */ (student.groupId),
      );
      const summaries = new Map(
        (await repo.summaries(list.map((s) => s.id))).map((s) => [
          s.sessionId,
          s,
        ]),
      );
      return list.map((session) => {
        const summary = summaries.get(session.id);
        return {
          ...session,
          waitingCount: summary?.waitingCount ?? 0,
          calledStudentId: summary?.calledStudentId ?? null,
        };
      });
    },

    /**
     * S11. Своя позиція й орієнтовний час: позиція — ранг серед waiting за
     * seq (ADR-0001); час = позиція × середня тривалість останніх 5 здач
     * (від виклику до результату), без них — позиція × 10 хв.
     * @param {string} sessionId
     */
    async myPosition(sessionId) {
      const { student } = await sessionOfMyGroup(sessionId);
      const entry = await repo.activeOfStudent(sessionId, student.id);
      if (!entry) throw noActiveEntry();
      if (entry.status !== "waiting") {
        return { status: entry.status, position: null, etaMinutes: null };
      }
      const position = await repo.rankOf(sessionId, entry.seq);
      const average = await repo.averageDurationMs(sessionId, ETA_SAMPLE);
      const etaMinutes =
        average === null
          ? position * ETA_DEFAULT_MINUTES
          : Math.ceil((position * average) / 60_000);
      return { status: entry.status, position, etaMinutes };
    },

    /**
     * S12. Студент виходить зі свого запису, лише з waiting (sf-13).
     * Лічильник неявок не змінюється.
     * @param {string} entryId
     */
    leave(entryId) {
      return unitOfWork(async () => {
        const entry = await repo.findEntry(entryId);
        if (!entry) throw entryNotFound();
        const student = identity.requireRole("student");
        if (entry.studentId !== student.id) throw notEntryOwner();
        await repo.lockTeacher(entry.teacherId);
        const fresh = /** @type {Entry} */ (await repo.findEntry(entryId));
        if (fresh.status !== "waiting") {
          throw entryStateConflict(fresh.status, "left");
        }
        return save(fresh, { status: "left", finishedAt: now() });
      });
    },

    /**
     * S13. Історія здач студента (passed, rework). Заняття, предмети й лаби —
     * пакетно, по одному виклику на довідник (ADR-0004, К16).
     * @returns {Promise<import("./model.js").HistoryItem[]>}
     */
    async history() {
      const student = identity.requireRole("student");
      const done = await repo.historyOf(student.id);
      const sessionList = await sessions.getByIds(done.map((e) => e.sessionId));
      const [subjects, labs] = await Promise.all([
        catalog.subjectsByIds(sessionList.map((s) => s.subjectId)),
        catalog.labsByIds(done.map((e) => e.labId)),
      ]);
      const sessionById = new Map(sessionList.map((s) => [s.id, s]));
      const subjectById = new Map(subjects.map((s) => [s.id, s]));
      const labById = new Map(labs.map((l) => [l.id, l]));
      return done.map((entry) => {
        const session = /** @type {import("../sessions/model.js").Session} */ (
          sessionById.get(entry.sessionId)
        );
        const subject = subjectById.get(session.subjectId);
        const lab = labById.get(entry.labId);
        return {
          entryId: entry.id,
          sessionId: entry.sessionId,
          startsAt: session.startsAt,
          subjectId: session.subjectId,
          subjectName: subject?.name ?? session.subjectId,
          labId: entry.labId,
          labNumber: lab?.number ?? 0,
          labTitle: lab?.title ?? entry.labId,
          status: /** @type {"passed" | "rework"} */ (entry.status),
          score: entry.score,
          finishedAt: /** @type {string} */ (entry.finishedAt),
        };
      });
    },

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
