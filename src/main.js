// Композиційний корінь: збирає platform і модулі та запускає сервер.
import * as catalog from "./modules/catalog/index.js";
import * as identity from "./modules/identity/index.js";
import * as queue from "./modules/queue/index.js";
import * as sessions from "./modules/sessions/index.js";
import {
  buildSha,
  createContext,
  createServer,
  readConfig,
} from "./platform/index.js";

const { port } = readConfig(process.env);
const context = createContext();
const app = createServer({ sha: buildSha(), context });

for (const domain of [identity, catalog, sessions, queue]) {
  await app.register(domain.plugin);
}

await app.listen({ port });
