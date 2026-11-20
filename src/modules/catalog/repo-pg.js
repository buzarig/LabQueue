// catalog у PostgreSQL (ADR-0032): лише пакетні читання за id — один запит
// на довідник, скільки б id не прийшло (data.md, «Запити сценаріїв»).

/**
 * @param {{ db: import("../../platform/db/index.js").DbAccess }} deps
 * @returns {import("./repo.js").CatalogRepo}
 */
export function createCatalogRepoPg({ db }) {
  /** @param {string[]} ids */
  const unique = (ids) => [...new Set(ids)];
  return {
    async groupsByIds(ids) {
      if (ids.length === 0) return [];
      return /** @type {any} */ (
        await db.read()`
          select id, name from catalog.groups
          where id = any(${unique(ids)}::text[]) order by id`
      );
    },
    async subjectsByIds(ids) {
      if (ids.length === 0) return [];
      return /** @type {any} */ (
        await db.read()`
          select id, name from catalog.subjects
          where id = any(${unique(ids)}::text[]) order by id`
      );
    },
    async labsByIds(ids) {
      if (ids.length === 0) return [];
      return /** @type {any} */ (
        await db.read()`
          select id, subject_id, number, title from catalog.labs
          where id = any(${unique(ids)}::text[]) order by subject_id, number`
      );
    },
  };
}
