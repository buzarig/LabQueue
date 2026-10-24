// identity у пам'яті (ADR-0027): таблиця identity.users із seed.json.
import seed from "./seed.json" with { type: "json" };

/**
 * @param {{ store: import("../../platform/memory.js").MemoryStore }} deps
 * @returns {import("./repo.js").IdentityRepo}
 */
export function createIdentityRepoMemory({ store }) {
  /** @type {ReturnType<typeof store.table<import("./model.js").User>>} */
  const users = store.table("identity.users");
  users.seed(
    seed.map((user) => [
      user.id,
      /** @type {import("./model.js").User} */ (user),
    ]),
  );
  return {
    async findById(id) {
      return users.get(id);
    },
  };
}
