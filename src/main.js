// Композиційний корінь: створює ресурси один раз і передає їх модулям
// (ADR-0030). Модулі не створюють одне одного й не імпортують platform.
// createApp — та сама збірка для запуску й для сценарної сюїти (К7, К10).
import { createCatalogModule } from "./modules/catalog/index.js";
import { createIdentityModule } from "./modules/identity/index.js";
import { createQueueModule } from "./modules/queue/index.js";
import { createSessionsModule } from "./modules/sessions/index.js";
import {
  buildSha,
  connectDb,
  createContext,
  createDbAccess,
  createMemoryStore,
  createPgBackend,
  createServer,
  createUnitOfWork,
  readConfig,
  readiness,
  systemClock,
} from "./platform/index.js";

/**
 * Застосунок з усіма модулями на обраному сховищі (ADR-0027). Для pg пул
 * перевіряється на старті: без БД — помилка одразу (ADR-0034).
 * @param {{
 *   storage?: "memory" | "pg",
 *   databaseUrl?: string,
 *   clock?: { now: () => Date },
 *   logger?: boolean,
 * }} [options]
 */
export async function createApp({
  storage = "memory",
  databaseUrl,
  clock = systemClock,
  logger = true,
} = {}) {
  const context = createContext();
  const sql =
    storage === "pg" ? await connectDb(String(databaseUrl)) : undefined;

  const app = createServer({
    sha: buildSha(),
    context,
    logger,
    ...(sql ? { ready: readiness(sql) } : {}),
  });

  /** @type {import("./platform/index.js").Storage} */
  let storageDeps;
  /** @type {Parameters<typeof createUnitOfWork>[0]["backend"]} */
  let backend;
  if (sql) {
    storageDeps = { kind: "pg", db: createDbAccess({ sql, context }) };
    backend = createPgBackend({
      sql,
      context,
      onRetry: (info) => app.log.warn(info, "повтор транзакції"),
    });
    app.addHook("onClose", () => sql.end());
  } else {
    const store = createMemoryStore({ context });
    storageDeps = { kind: "memory", store };
    backend = store;
  }
  const unitOfWork = createUnitOfWork({ context, clock, backend });

  const identity = createIdentityModule({ storage: storageDeps, context });
  const catalog = createCatalogModule({ storage: storageDeps });
  const sessions = createSessionsModule({
    storage: storageDeps,
    identity: identity.api,
    catalog: catalog.api,
    unitOfWork,
  });
  const queue = createQueueModule({
    storage: storageDeps,
    identity: identity.api,
    sessions: sessions.api,
    catalog: catalog.api,
    unitOfWork,
    clock,
  });

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
  const { port, storage, databaseUrl } = readConfig(process.env);
  const app = await createApp({ storage, databaseUrl }).catch((error) => {
    // Fail-fast (ADR-0034, К15): зрозуміле повідомлення й код 1.
    console.error(`labqueue: старт неможливий — ${error.message}`);
    process.exit(1);
  });
  await app.listen({ port });
}
