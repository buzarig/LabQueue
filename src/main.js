// Композиційний корінь: створює ресурси один раз і передає їх модулям
// (ADR-0030). Модулі не створюють одне одного й не імпортують platform.
// createApp — та сама збірка для запуску й для сценарної сюїти (К7, К10).
import { createCatalogModule } from "./modules/catalog/index.js";
import { createIdentityModule } from "./modules/identity/index.js";
import { createQueueModule } from "./modules/queue/index.js";
import { createSessionsModule } from "./modules/sessions/index.js";
import {
  buildSha,
  createContext,
  createMemoryStore,
  createServer,
  createUnitOfWork,
  readConfig,
  systemClock,
} from "./platform/index.js";

/**
 * Застосунок з усіма модулями. Поки що лише статика; PostgreSQL і вибір
 * сховища — з інтеграцією БД (ADR-0027).
 * @param {{ clock?: { now: () => Date }, logger?: boolean }} [options]
 */
export async function createApp({ clock = systemClock, logger = true } = {}) {
  const context = createContext();
  const store = createMemoryStore({ context });
  const unitOfWork = createUnitOfWork({ context, clock, backend: store });

  const identity = createIdentityModule({ store, context });
  const catalog = createCatalogModule({ store });
  const sessions = createSessionsModule({
    store,
    identity: identity.api,
    catalog: catalog.api,
    unitOfWork,
  });
  const queue = createQueueModule({
    store,
    identity: identity.api,
    sessions: sessions.api,
    catalog: catalog.api,
    unitOfWork,
    clock,
  });

  const app = createServer({ sha: buildSha(), context, logger });
  for (const plugin of [
    identity.plugin,
    catalog.plugin,
    sessions.plugin,
    queue.plugin,
  ]) {
    await app.register(plugin);
  }
  return app;
}

if (import.meta.main) {
  const { port } = readConfig(process.env);
  const app = await createApp();
  await app.listen({ port });
}
