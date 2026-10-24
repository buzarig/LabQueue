// К15, ADR-0034: застосунок без БД не стартує (код 1, зрозуміле повідомлення
// без пароля); з БД — слухає порт і /ready відповідає 200.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { createTestDb } from "./harness.js";

const MAIN = resolve(import.meta.dirname, "../../src/main.js");

/** @returns {Promise<number>} */
const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, () => {
      const address = server.address();
      server.close(() =>
        done(typeof address === "object" && address ? address.port : 0),
      );
    });
  });

/**
 * @param {Record<string, string>} env
 * @returns {import("node:child_process").ChildProcess & { stderrText: () => string }}
 */
function start(env) {
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  return Object.assign(child, { stderrText: () => stderr });
}

test("БД недоступна на старті → код 1 за кілька секунд, без пароля в повідомленні", async () => {
  const child = start({
    STORAGE: "pg",
    DATABASE_URL: "postgres://labqueue:таємниця@127.0.0.1:1/labqueue_dev",
    PORT: String(await freePort()),
  });
  const started = Date.now();
  const code = await new Promise((done) => child.on("exit", done));
  assert.equal(code, 1);
  assert.ok(Date.now() - started < 5000);
  assert.match(child.stderrText(), /старт неможливий — БД недоступна/);
  assert.doesNotMatch(child.stderrText(), /таємниця/);
});

test("STORAGE=pg без DATABASE_URL → код 1", async () => {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, STORAGE: "pg" };
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, [MAIN], { env, stdio: "ignore" });
  assert.equal(await new Promise((done) => child.on("exit", done)), 1);
});

test("з БД — слухає порт, /ready → 200", async () => {
  const db = await createTestDb();
  const port = await freePort();
  const child = start({
    STORAGE: "pg",
    DATABASE_URL: db.url,
    PORT: String(port),
  });
  after(async () => {
    child.kill();
    await new Promise((done) => child.on("exit", done));
    await db.drop();
  });
  const deadline = Date.now() + 5000;
  /** @type {Response | undefined} */
  let res;
  while (Date.now() < deadline) {
    res = await fetch(`http://127.0.0.1:${port}/ready`).catch(() => undefined);
    if (res) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(res?.status, 200, child.stderrText());
  assert.deepEqual(await res?.json(), { status: "ready" });
});
