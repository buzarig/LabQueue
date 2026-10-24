// Моделі queue (ADR-0031): записи черги й неявки (architecture.md, «Дані (ER)»,
// «Стани» → QueueEntry; ADR-0001, ADR-0003, ADR-0029).

/**
 * @typedef {"waiting" | "called" | "submitting" | "passed" | "rework" | "left" | "dropped" | "missed"} EntryStatus
 */

/** Активні статуси (I1, I2). */
export const ACTIVE = /** @type {const} */ ([
  "waiting",
  "called",
  "submitting",
]);

/**
 * Запис черги. teacherId — незмінна копія з заняття (ADR-0029). Позиція не
 * зберігається: це ранг серед waiting за seq (ADR-0001). Час — рядки ISO.
 * @typedef {{
 *   id: string,
 *   sessionId: string,
 *   teacherId: string,
 *   studentId: string,
 *   labId: string,
 *   status: EntryStatus,
 *   seq: number,
 *   enqueuedAt: string,
 *   calledAt: string | null,
 *   startedAt: string | null,
 *   finishedAt: string | null,
 *   score: number | null,
 * }} Entry
 */

/** @typedef {{ sessionId: string, studentId: string, count: number }} NoShow */

/** @typedef {{ outcome: "passed" | "rework", score?: number }} Result */

/**
 * Зведення черги заняття для S9.
 * @typedef {{ sessionId: string, waitingCount: number, calledStudentId: string | null }} QueueSummary
 */

/**
 * Рядок історії S13 (data.md: дата, предмет, лаба, бал).
 * @typedef {{
 *   entryId: string,
 *   sessionId: string,
 *   startsAt: string,
 *   subjectId: string,
 *   subjectName: string,
 *   labId: string,
 *   labNumber: number,
 *   labTitle: string,
 *   status: "passed" | "rework",
 *   score: number | null,
 *   finishedAt: string,
 * }} HistoryItem
 */
