// Публічна точка входу модуля queue — записи черги, позиції, неявки, історія здач (QueueEntry, NoShow).
// Межі й дані — docs/specs/lab1-foundation/architecture.md, «Модулі»; шари — ADR-0031.
import { createQueueRepoMemory } from "./repo-memory.js";
import { createQueueRepoPg } from "./repo-pg.js";
import { registerQueueRoutes } from "./routes.js";
import { createQueueService } from "./service.js";

/**
 * Модуль queue. Ресурси й API інших модулів передає main.js (ADR-0030).
 * @param {{
 *   storage: import("../../platform/index.js").Storage,
 *   identity: import("../identity/index.js").IdentityApi,
 *   sessions: import("../sessions/index.js").SessionsApi,
 *   catalog: import("../catalog/index.js").CatalogApi,
 *   unitOfWork: import("../../platform/unit-of-work.js").UnitOfWork,
 *   clock: { now: () => Date },
 * }} deps
 */
export function createQueueModule({
  storage,
  identity,
  sessions,
  catalog,
  unitOfWork,
  clock,
}) {
  const service = createQueueService({
    repo:
      storage.kind === "pg"
        ? createQueueRepoPg({ db: storage.db })
        : createQueueRepoMemory({ store: storage.store }),
    identity,
    sessions,
    catalog,
    unitOfWork,
    clock,
  });
  return {
    /**
     * Fastify-плагін (ADR-0009): маршрути S4–S13.
     * @param {import("fastify").FastifyInstance} app
     */
    async plugin(app) {
      registerQueueRoutes(app, { service });
    },
  };
}
