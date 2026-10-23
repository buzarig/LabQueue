// Композиційний корінь: створює ресурси один раз і передає їх модулям
// (ADR-0030). Модулі не створюють одне одного й не імпортують platform.
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

const { port } = readConfig(process.env);
const context = createContext();
// Поки що лише статика; PostgreSQL і STORAGE — з інтеграцією БД (ADR-0027).
const store = createMemoryStore({ context });
const unitOfWork = createUnitOfWork({
  context,
  clock: systemClock,
  backend: store,
});

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
  clock: systemClock,
});

const app = createServer({ sha: buildSha(), context });
for (const plugin of [
  identity.plugin,
  catalog.plugin,
  sessions.plugin,
  queue.plugin,
]) {
  await app.register(plugin);
}

await app.listen({ port });
