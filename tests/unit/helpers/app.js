// Застосунок для тестів: ті самі модулі, що в main.js, на сховищі в пам'яті,
// з керованим годинником і зручними запитами від імені користувача.
import { randomUUID } from "node:crypto";
import { createCatalogModule } from "../../../src/modules/catalog/index.js";
import { createIdentityModule } from "../../../src/modules/identity/index.js";
import { createSessionsModule } from "../../../src/modules/sessions/index.js";
import { createContext } from "../../../src/platform/context.js";
import { createMemoryStore } from "../../../src/platform/memory.js";
import { createServer } from "../../../src/platform/server.js";
import { createUnitOfWork } from "../../../src/platform/unit-of-work.js";

export async function createTestApp() {
  let now = new Date("2026-10-23T09:00:00Z");
  const clock = { now: () => now };
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
  const app = createServer({ sha: "test", context, logger: false });
  for (const plugin of [identity.plugin, catalog.plugin, sessions.plugin]) {
    await app.register(plugin);
  }
  await app.ready();

  /**
   * POST від імені користувача; ключ ідемпотентності — новий, якщо не задано.
   * @param {string} user
   * @param {string} url
   * @param {unknown} [payload]
   * @param {{ key?: string }} [opts]
   */
  const post = (user, url, payload = {}, opts = {}) =>
    app.inject({
      method: "POST",
      url,
      headers: {
        "x-user-id": user,
        "idempotency-key": opts.key ?? randomUUID(),
      },
      payload: /** @type {object} */ (payload),
    });

  /**
   * @param {string} user
   * @param {string} url
   */
  const get = (user, url) =>
    app.inject({ method: "GET", url, headers: { "x-user-id": user } });

  /**
   * Виклик API модуля в контексті «запиту» від імені користувача.
   * @template T
   * @param {string} userId
   * @param {() => Promise<T>} fn
   */
  const asUser = (userId, fn) =>
    context.run(
      {
        processId: "test",
        user: { id: userId, role: "teacher", groupId: null },
      },
      fn,
    );

  return {
    app,
    post,
    get,
    asUser,
    unitOfWork,
    sessions: sessions.api,
    /** @param {number} ms */
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
  };
}

/** Тіло S1 за замовчуванням: Node.js для КН-21, лаби 1–2. */
export const newSession = (
  /** @type {Record<string, unknown>} */ over = {},
) => ({
  subjectId: "nodejs",
  groupId: "kn-21",
  startsAt: "2026-10-23T10:00:00Z",
  room: "301",
  queueLimit: 10,
  labIds: ["nodejs-1", "nodejs-2"],
  ...over,
});
