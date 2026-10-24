// Сервіс catalog (ADR-0031): довідники лише читаються — CRUD поза обсягом
// (spec, «Не робимо»). Невідомі id просто відсутні в результаті; що з цього
// випливає (UNKNOWN_REFERENCE у S1), вирішує модуль, який питає.

/** @param {{ repo: import("./repo.js").CatalogRepo }} deps */
export function createCatalogService({ repo }) {
  return {
    /** @param {string[]} ids */
    groupsByIds: (ids) => repo.groupsByIds(ids),
    /** @param {string[]} ids */
    subjectsByIds: (ids) => repo.subjectsByIds(ids),
    /** @param {string[]} ids */
    labsByIds: (ids) => repo.labsByIds(ids),
  };
}
