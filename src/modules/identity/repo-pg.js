// identity у PostgreSQL (ADR-0032): identity.users. Колонки → поля camelCase
// робить драйвер; тут — лише SQL модуля (ADR-0031).

/**
 * @param {{ db: import("../../platform/db/index.js").DbAccess }} deps
 * @returns {import("./repo.js").IdentityRepo}
 */
export function createIdentityRepoPg({ db }) {
  return {
    async findById(id) {
      const [row] = await db.read()`
        select id, name, role, group_id from identity.users where id = ${id}`;
      return /** @type {import("./model.js").User | undefined} */ (row);
    },
  };
}
