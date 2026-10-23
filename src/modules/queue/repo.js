// Контракт репозиторію queue (ADR-0031): реалізації — repo-memory.js, пізніше repo-pg.js.
// Кожна функція — один запит у PostgreSQL (data.md, «Запити сценаріїв»).

/**
 * @typedef {import("./model.js").Entry} Entry
 * @typedef {{
 *   lockTeacher: (teacherId: string) => Promise<void>,
 *   findEntry: (id: string) => Promise<Entry | undefined>,
 *   activeOfStudent: (sessionId: string, studentId: string) => Promise<Entry | undefined>,
 *   countActive: (sessionId: string) => Promise<number>,
 *   maxSeq: (sessionId: string) => Promise<number>,
 *   firstWaiting: (sessionId: string) => Promise<Entry | undefined>,
 *   teacherBusy: (teacherId: string) => Promise<boolean>,
 *   insertEntry: (entry: Entry) => Promise<void>,
 *   updateEntry: (entry: Entry) => Promise<void>,
 *   noShowCount: (sessionId: string, studentId: string) => Promise<number>,
 *   addNoShow: (sessionId: string, studentId: string) => Promise<number>,
 * }} QueueRepo
 */

export {};
