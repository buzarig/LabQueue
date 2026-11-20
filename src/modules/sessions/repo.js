// Контракт репозиторію sessions (ADR-0031): реалізації — repo-memory.js, пізніше repo-pg.js.

/**
 * @typedef {import("./model.js").Session} Session
 * @typedef {{
 *   lockTeacher: (teacherId: string) => Promise<void>,
 *   findById: (id: string) => Promise<Session | undefined>,
 *   findByIds: (ids: string[]) => Promise<Session[]>,
 *   findByGroup: (groupId: string) => Promise<Session[]>,
 *   insert: (session: Session) => Promise<void>,
 *   updateState: (id: string, state: import("./model.js").SessionState) => Promise<void>,
 * }} SessionsRepo
 */

export {};
