// /ready перевіряє схему (аудит лаби 4, ADR-0045): з'єднання є, але структурні
// міграції не застосовано — 503, щоб blue-green не пустив трафік на версію,
// яка на кожен запит відповідає 500. Так поводився перший деплой на staging.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { migrate, MIGRATIONS } from "../../scripts/migrate.js";
import { createApp } from "../../src/main.js";
import { createTestDb } from "./harness.js";

/** @type {Awaited<ReturnType<typeof createTestDb>>} */
let db;
/** @type {Array<{ close: () => Promise<unknown> }>} */
const apps = [];
const tmp = mkdtempSync(join(tmpdir(), "labqueue-ready-"));

before(async () => {
  db = await createTestDb({ empty: true });
});

after(async () => {
  for (const app of apps) await app.close();
  await db?.drop();
  rmSync(tmp, { recursive: true, force: true });
});

/** @param {string} [migrationsDir] */
async function readyStatus(migrationsDir) {
  const app = await createApp({
    storage: "pg",
    databaseUrl: db.url,
    logger: false,
    ...(migrationsDir ? { migrationsDir } : {}),
  });
  apps.push(app);
  return (await app.inject({ url: "/ready" })).statusCode;
}

test("БД є, міграцій немає → /ready 503", async () => {
  assert.equal(await readyStatus(), 503);
});

test("структурні міграції застосовано → /ready 200", async () => {
  const sql = db.connect();
  try {
    await migrate(sql);
  } finally {
    await sql.end();
  }
  assert.equal(await readyStatus(), 200);
});

test("нова версія з міграцією, якої в БД ще немає → /ready 503", async () => {
  const dir = join(tmp, "migrations");
  cpSync(MIGRATIONS, dir, { recursive: true });
  writeFileSync(join(dir, "999-not-yet.sql"), "select 1;\n");
  assert.equal(await readyStatus(dir), 503);
});
