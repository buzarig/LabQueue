// catalog у пам'яті (ADR-0027): catalog.groups, catalog.subjects, catalog.labs із seed.json.
import seed from "./seed.json" with { type: "json" };

/**
 * @template {{ id: string }} T
 * @param {{ get: (id: string) => T | undefined }} table
 * @param {string[]} ids
 * @returns {T[]}
 */
function byIds(table, ids) {
  return [...new Set(ids)]
    .map((id) => table.get(id))
    .filter((row) => row !== undefined);
}

/**
 * @param {{ store: import("../../platform/memory.js").MemoryStore }} deps
 * @returns {import("./repo.js").CatalogRepo}
 */
export function createCatalogRepoMemory({ store }) {
  /** @type {ReturnType<typeof store.table<import("./model.js").Group>>} */
  const groups = store.table("catalog.groups");
  /** @type {ReturnType<typeof store.table<import("./model.js").Subject>>} */
  const subjects = store.table("catalog.subjects");
  /** @type {ReturnType<typeof store.table<import("./model.js").Lab>>} */
  const labs = store.table("catalog.labs");
  groups.seed(seed.groups.map((row) => [row.id, row]));
  subjects.seed(seed.subjects.map((row) => [row.id, row]));
  labs.seed(seed.labs.map((row) => [row.id, row]));
  return {
    async groupsByIds(ids) {
      return byIds(groups, ids);
    },
    async subjectsByIds(ids) {
      return byIds(subjects, ids);
    },
    async labsByIds(ids) {
      return byIds(labs, ids);
    },
  };
}
