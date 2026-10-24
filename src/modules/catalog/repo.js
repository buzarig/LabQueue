// Контракт репозиторію catalog (ADR-0031). Лише пакетні читання за id —
// інші модулі не ходять за довідником у циклі (data.md, «Запити сценаріїв»).

/**
 * @typedef {{
 *   groupsByIds: (ids: string[]) => Promise<import("./model.js").Group[]>,
 *   subjectsByIds: (ids: string[]) => Promise<import("./model.js").Subject[]>,
 *   labsByIds: (ids: string[]) => Promise<import("./model.js").Lab[]>,
 * }} CatalogRepo
 */

export {};
