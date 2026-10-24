// Публічна точка входу модуля platform. Інші файли модуля — внутрішні.
export { buildSha } from "./build-info.js";
export { systemClock } from "./clock.js";
export { readConfig } from "./config.js";
export { createContext } from "./context.js";
export {
  connectDb,
  createDbAccess,
  createPgBackend,
  readiness,
} from "./db/index.js";
export { createMemoryStore } from "./memory.js";
export { createServer } from "./server.js";
export { createUnitOfWork } from "./unit-of-work.js";
