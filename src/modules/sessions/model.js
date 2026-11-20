// Моделі sessions (ADR-0031): заняття і лаби, які на ньому приймаються
// (architecture.md, «Дані (ER)», «Стани» → Session).

/** @typedef {"planned" | "open" | "closed" | "finished"} SessionState */

/**
 * Заняття разом зі списком лаб (sessions.sessions + sessions.session_labs).
 * startsAt — рядок ISO 8601 у UTC.
 * @typedef {{
 *   id: string,
 *   subjectId: string,
 *   groupId: string,
 *   teacherId: string,
 *   startsAt: string,
 *   room: string,
 *   queueLimit: number,
 *   state: SessionState,
 *   labIds: string[],
 * }} Session
 */

/**
 * Вхід S1 після валідації схемою.
 * @typedef {{
 *   subjectId: string,
 *   groupId: string,
 *   startsAt: string,
 *   room: string,
 *   queueLimit: number,
 *   labIds: string[],
 * }} NewSession
 */

export {};
