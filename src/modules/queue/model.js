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
