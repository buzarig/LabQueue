// Композиційний корінь: створює ресурси один раз і передає їх модулям
// (ADR-0030). Модулі не створюють одне одного й не імпортують platform.
import { createCatalogModule } from "./modules/catalog/index.js";
import { createIdentityModule } from "./modules/identity/index.js";
import * as queue from "./modules/queue/index.js";
import * as sessions from "./modules/sessions/index.js";
import {
  buildSha,
  createContext,
  createMemoryStore,
  createServer,
  readConfig,
} from "./platform/index.js";

const { port } = readConfig(process.env);
const context = createContext();
// Поки що лише статика; PostgreSQL і STORAGE — з інтеграцією БД (ADR-0027).
const store = createMemoryStore({ context });

const identity = createIdentityModule({ store, context });
const catalog = createCatalogModule({ store });

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
