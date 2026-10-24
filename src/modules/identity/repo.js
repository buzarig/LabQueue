// Контракт репозиторію identity (ADR-0031): реалізації — repo-memory.js, пізніше repo-pg.js.

/**
 * @typedef {{
 *   findById: (id: string) => Promise<import("./model.js").User | undefined>,
 * }} IdentityRepo
 */

export {};
