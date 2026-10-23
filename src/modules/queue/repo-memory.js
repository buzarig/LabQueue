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
    async hasSubmitting(sessionId) {
      return ofSession(sessionId).some(
        (entry) => entry.status === "submitting",
      );
    },
    async missActive(sessionId, at) {
      const active = ofSession(sessionId).filter(
        (entry) => entry.status === "waiting" || entry.status === "called",
      );
      for (const entry of active) {
        entries.put(entry.id, { ...entry, status: "missed", finishedAt: at });
      }
      return active.length;
    },
    async summaries(sessionIds) {
      const wanted = new Set(sessionIds);
      /** @type {Map<string, import("./model.js").QueueSummary>} */
      const result = new Map(
        [...wanted].map((sessionId) => [
          sessionId,
          { sessionId, waitingCount: 0, calledStudentId: null },
        ]),
      );
      for (const entry of entries.all()) {
        const summary = result.get(entry.sessionId);
        if (!summary) continue;
        if (entry.status === "waiting") summary.waitingCount += 1;
        if (entry.status === "called" || entry.status === "submitting") {
          summary.calledStudentId = entry.studentId;
        }
      }
      return [...result.values()];
    },
    async rankOf(sessionId, seq) {
      return (
        ofSession(sessionId).filter(
          (entry) => entry.status === "waiting" && entry.seq < seq,
        ).length + 1
      );
    },
    async averageDurationMs(sessionId, limit) {
      const recent = ofSession(sessionId)
        .filter(
          (entry) =>
            (entry.status === "passed" || entry.status === "rework") &&
            entry.calledAt &&
            entry.finishedAt,
        )
        .sort((a, b) =>
          String(b.finishedAt).localeCompare(String(a.finishedAt)),
        )
        .slice(0, limit);
      if (recent.length === 0) return null;
      const total = recent.reduce(
        (sum, entry) =>
          sum +
          Date.parse(String(entry.finishedAt)) -
          Date.parse(String(entry.calledAt)),
        0,
      );
      return total / recent.length;
    },
    async historyOf(studentId) {
      return entries
        .all()
        .filter(
          (entry) =>
            entry.studentId === studentId &&
            (entry.status === "passed" || entry.status === "rework"),
        )
        .sort((a, b) =>
          String(b.finishedAt).localeCompare(String(a.finishedAt)),
        );
    },
    async addNoShow(sessionId, studentId) {
      const id = noShowId(sessionId, studentId);
      const count = (noShows.get(id)?.count ?? 0) + 1;
      noShows.put(id, { sessionId, studentId, count });
      return count;
    },
  };
}
