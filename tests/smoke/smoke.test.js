// Smoke-тест зібраного застосунку (К8, CHK-06). Запускає саме dist/, а не src/.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { after, test } from "node:test";

/** @type {Array<() => void>} */
const stops = [];
after(() => stops.forEach((stop) => stop()));

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Стартує зібраний застосунок і чекає, доки відповість /health.
 * @param {string} entry
 * @returns {Promise<string>} базова адреса
 */
async function start(entry) {
  assert.ok(existsSync(entry), `${entry} не знайдено — спершу make build`);
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  stops.push(() => child.kill());
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/health`);
      return base;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`${entry} не відповів на /health за 5 с`);
}

/**
 * @param {string} url
 * @returns {Promise<{ status: number, body: unknown }>}
 */
async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

test("dist/: GET /health → 200 {status: ok}", async () => {
  const base = await start("dist/main.js");
  assert.deepEqual(await getJson(`${base}/health`), {
    status: 200,
    body: { status: "ok" },
  });
});

test("dist/: GET /version → sha поточного коміту", async () => {
  const base = await start("dist/main.js");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.deepEqual(await getJson(`${base}/version`), {
    status: 200,
    body: { sha },
  });
});

test("збірка без git: GET /version → {sha: unknown}", async () => {
  const outdir = "dist/smoke-no-git";
  execFileSync(process.execPath, ["scripts/build.js", outdir], {
    env: { ...process.env, GIT_DIR: "/nonexistent" },
  });
  const base = await start(`${outdir}/main.js`);
  assert.deepEqual(await getJson(`${base}/version`), {
    status: 200,
    body: { sha: "unknown" },
  });
});
