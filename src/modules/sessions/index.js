// Публічна точка входу модуля sessions — заняття, стан запису, право власника (Session, SessionLab).
// Межі й дані — docs/specs/lab1-foundation/architecture.md, «Модулі»; шари — ADR-0031.
import { createSessionsRepoMemory } from "./repo-memory.js";
import { registerSessionsRoutes } from "./routes.js";
import { createSessionsService } from "./service.js";

/**
 * Модуль sessions. Ресурси й API інших модулів передає main.js (ADR-0030).
 * @param {{
 *   store: import("../../platform/memory.js").MemoryStore,
 *   identity: import("../identity/index.js").IdentityApi,
 *   catalog: import("../catalog/index.js").CatalogApi,
 *   unitOfWork: import("../../platform/unit-of-work.js").UnitOfWork,
 * }} deps
 */
export function createSessionsModule({ store, identity, catalog, unitOfWork }) {
  const service = createSessionsService({
    repo: createSessionsRepoMemory({ store }),
    identity,
    catalog,
    unitOfWork,
  });

  return {
    /**
     * Fastify-плагін (ADR-0009): маршрути S1–S3.
     * @param {import("fastify").FastifyInstance} app
     */
    async plugin(app) {
      registerSessionsRoutes(app, { service });
    },
    /**
     * API для queue: читання занять і перехід «завершене», який за ADR-0005
     * викликає лише queue в межах S4.
     */
    api: {
      getById: service.getById,
      getByIds: service.getByIds,
      getByGroup: service.getByGroup,
      markFinished: service.markFinished,
    },
  };
}

/** @typedef {ReturnType<typeof createSessionsModule>["api"]} SessionsApi */
