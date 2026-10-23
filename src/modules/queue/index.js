// Публічна точка входу модуля queue — записи черги, позиції, неявки, історія здач (QueueEntry, NoShow).
// Межі й дані — docs/specs/lab1-foundation/architecture.md, «Модулі»; шари — ADR-0031.
import { createQueueRepoMemory } from "./repo-memory.js";
import { registerQueueRoutes } from "./routes.js";
import { createQueueService } from "./service.js";

/**
 * Модуль queue. Ресурси й API інших модулів передає main.js (ADR-0030).
 * @param {{
 *   store: import("../../platform/memory.js").MemoryStore,
 *   identity: import("../identity/index.js").IdentityApi,
 *   sessions: import("../sessions/index.js").SessionsApi,
 *   unitOfWork: import("../../platform/unit-of-work.js").UnitOfWork,
 *   clock: { now: () => Date },
 * }} deps
 */
export function createQueueModule({
  store,
  identity,
  sessions,
  unitOfWork,
  clock,
}) {
  const service = createQueueService({
    repo: createQueueRepoMemory({ store }),
    identity,
    sessions,
    unitOfWork,
    clock,
  });
  return {
    /**
     * Fastify-плагін (ADR-0009): маршрути S5–S8, S10.
     * @param {import("fastify").FastifyInstance} app
     */
    async plugin(app) {
      registerQueueRoutes(app, { service });
    },
  };
}
