// TCP-проксі між застосунком і PostgreSQL для тестів збоїв (К14): обрив
// з'єднань і недоступність БД без зупинки спільного кластера; однаково
// локально й у CI.
import { connect, createServer } from "node:net";

/**
 * @param {string} databaseUrl справжня БД
 */
export async function createProxy(databaseUrl) {
  const target = new URL(databaseUrl);
  /** @type {Set<import("node:net").Socket>} */
  const sockets = new Set();
  /** @type {import("node:net").Server} */
  let server;

  /** @param {number} port */
  const listen = (port) =>
    new Promise((resolve) => {
      server = createServer((client) => {
        const upstream = connect(Number(target.port), target.hostname);
        const kill = () => {
          client.destroy();
          upstream.destroy();
          sockets.delete(client);
          sockets.delete(upstream);
        };
        for (const socket of [client, upstream]) {
          sockets.add(socket);
          socket.on("error", kill);
          socket.on("close", kill);
        }
        client.pipe(upstream).pipe(client);
      });
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });

  const port = /** @type {number} */ (await listen(0));
  const url = new URL(databaseUrl);
  url.host = `127.0.0.1:${port}`;

  return {
    /** URL БД через проксі. */
    url: url.href,
    /** Обрив усіх з'єднань; нові підключення працюють. */
    drop() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    /** БД недоступна: з'єднання обірвано, нові — ECONNREFUSED. */
    async down() {
      this.drop();
      await new Promise((resolve) => server.close(resolve));
    },
    /** БД знову доступна на тому самому порту. */
    async up() {
      await listen(port);
    },
    /** Закрити проксі наприкінці тестів, щоб процес завершився. */
    async close() {
      this.drop();
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    },
  };
}
