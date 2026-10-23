// queue у пам'яті (ADR-0027): queue.entries і queue.no_shows, як у data.md.
import { ACTIVE } from "./model.js";

/** @typedef {import("./model.js").Entry} Entry */
/** @typedef {import("./model.js").NoShow} NoShow */

/** @param {string} status */
const isActive = (status) =>
  /** @type {readonly string[]} */ (ACTIVE).includes(status);

/**
 * @param {{ store: import("../../platform/memory.js").MemoryStore }} deps
 * @returns {import("./repo.js").QueueRepo}
 */
export function createQueueRepoMemory({ store }) {
  /** @type {ReturnType<typeof store.table<Entry>>} */
  const entries = store.table("queue.entries");
  /** @type {ReturnType<typeof store.table<NoShow>>} */
  const noShows = store.table("queue.no_shows");

  /** @param {string} sessionId */
  const ofSession = (sessionId) =>
    entries.all().filter((entry) => entry.sessionId === sessionId);
  /** @param {string} sessionId @param {string} studentId */
  const noShowId = (sessionId, studentId) => `${sessionId}\u0000${studentId}`;

  return {
    async lockTeacher(teacherId) {
      await store.lockTeacher(teacherId);
    },
    async findEntry(id) {
      return entries.get(id);
    },
    async activeOfStudent(sessionId, studentId) {
      return ofSession(sessionId).find(
        (entry) => entry.studentId === studentId && isActive(entry.status),
      );
    },
    async countActive(sessionId) {
      return ofSession(sessionId).filter((entry) => isActive(entry.status))
        .length;
    },
    async maxSeq(sessionId) {
      return Math.max(0, ...ofSession(sessionId).map((entry) => entry.seq));
    },
    async firstWaiting(sessionId) {
      return ofSession(sessionId)
        .filter((entry) => entry.status === "waiting")
        .sort((a, b) => a.seq - b.seq)[0];
    },
    async teacherBusy(teacherId) {
      return entries
        .all()
        .some(
          (entry) =>
            entry.teacherId === teacherId &&
            (entry.status === "called" || entry.status === "submitting"),
        );
    },
    async insertEntry(entry) {
      entries.put(entry.id, entry);
    },
    async updateEntry(entry) {
      entries.put(entry.id, entry);
    },
    async noShowCount(sessionId, studentId) {
      return noShows.get(noShowId(sessionId, studentId))?.count ?? 0;
    },
    async addNoShow(sessionId, studentId) {
      const id = noShowId(sessionId, studentId);
      const count = (noShows.get(id)?.count ?? 0) + 1;
      noShows.put(id, { sessionId, studentId, count });
      return count;
    },
  };
}
