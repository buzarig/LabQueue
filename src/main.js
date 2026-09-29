// Композиційний корінь: збирає platform і модулі та запускає сервер.
import { buildSha, createServer, readConfig } from "./platform/index.js";

const { port } = readConfig(process.env);
const app = createServer({ sha: buildSha() });

await app.listen({ port });
