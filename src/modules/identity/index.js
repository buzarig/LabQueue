// Публічна точка входу модуля identity — хто робить запит і яка в нього роль (User).
// Межі й дані — docs/specs/lab1-foundation/architecture.md, «Модулі»; шари — ADR-0031.
import { createIdentityRepoMemory } from "./repo-memory.js";
import { createIdentityRepoPg } from "./repo-pg.js";
import { registerIdentityRoutes } from "./routes.js";
import { createIdentityService } from "./service.js";

/**
 * Модуль identity. Ресурси передає main.js один раз (ADR-0030).
 * @param {{
 *   storage: import("../../platform/index.js").Storage,
 *   context: import("../../platform/context.js").Context,
 * }} deps
 */
export function createIdentityModule({ storage, context }) {
  const service = createIdentityService({
    repo:
      storage.kind === "pg"
        ? createIdentityRepoPg({ db: storage.db })
        : createIdentityRepoMemory({ store: storage.store }),
    context,
  });

  /**
   * Fastify-плагін (ADR-0009) без інкапсуляції: хук автентифікації діє на всі
   * маршрути застосунку, а не лише на маршрути цього плагіна.
   * @param {import("fastify").FastifyInstance} app
   */
  async function plugin(app) {
    registerIdentityRoutes(app, { service });
  }
  Object.defineProperty(plugin, Symbol.for("skip-override"), { value: true });

  return {
    plugin,
    /** API для інших модулів: користувач-ініціатор і його роль. */
    api: {
      currentUser: () => service.currentUser(),
      /** @param {import("./model.js").Role} role */
      requireRole: (role) => service.requireRole(role),
    },
  };
}

/** @typedef {ReturnType<typeof createIdentityModule>["api"]} IdentityApi */
