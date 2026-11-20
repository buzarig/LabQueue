// Публічна точка входу модуля catalog — довідники: предмети, групи, лаби (Subject, Group, Lab).
// Межі й дані — docs/specs/lab1-foundation/architecture.md, «Модулі»; шари — ADR-0031.
import { createCatalogRepoMemory } from "./repo-memory.js";
import { createCatalogRepoPg } from "./repo-pg.js";
import { createCatalogService } from "./service.js";

/**
 * Модуль catalog. Маршрутів немає: довідники в контракті S1–S13 не мають
 * власних ендпоінтів (data.md, «HTTP-контракт»).
 * @param {{ storage: import("../../platform/index.js").Storage }} deps
 */
export function createCatalogModule({ storage }) {
  const service = createCatalogService({
    repo:
      storage.kind === "pg"
        ? createCatalogRepoPg({ db: storage.db })
        : createCatalogRepoMemory({ store: storage.store }),
  });
  return {
    /** Fastify-плагін (ADR-0009). */
    async plugin() {},
    /** API для sessions (S1) і queue (S13). */
    api: service,
  };
}

/** @typedef {ReturnType<typeof createCatalogModule>["api"]} CatalogApi */
