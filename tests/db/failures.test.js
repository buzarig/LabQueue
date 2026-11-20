// К14, ADR-0034: поведінка на збоях джерела через HTTP на справжньому
// PostgreSQL. Обрив і недоступність — через TCP-проксі; довгий запит і друга
// лінія — через пряме з'єднання з БД повз застосунок.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { createApp } from "../../src/main.js";
import { createTestDb } from "./harness.js";
import { createProxy } from "./proxy.js";

/** @type {Awaited<ReturnType<typeof createTestDb>>} */
let db;
/** @type {Awaited<ReturnType<typeof createProxy>>} */
let proxy;
/** @type {Awaited<ReturnType<typeof createApp>>} */
let app;
/** Пряме з'єднання повз застосунок і проксі. @type {import("postgres").Sql} */
let side;
/** @type {Array<Record<string, any>>} */
const logs = [];

before(async () => {
  db = await createTestDb();
  side = db.connect();
  proxy = await createProxy(db.url);
  app = await createApp({
    storage: "pg",
    databaseUrl: proxy.url,
    logStream: { write: (line) => void logs.push(JSON.parse(line)) },
  });
});
after(async () => {
  await app.close();
  await proxy.close();
  await side.end();
  await db.drop();
});

/**
 * @param {string} user
 * @param {string} url
 * @param {unknown} [payload]
 */
const post = (user, url, payload = {}) =>
  app.inject({
    method: "POST",
    url,
    headers: { "x-user-id": user, "idempotency-key": randomUUID() },
    payload: /** @type {object} */ (payload),
  });

/** Заняття t-1 з відкритим записом і чергою з указаних студентів. */
async function sessionWith(/** @type {string[]} */ students) {
  const created = await post("t-1", "/sessions", {
    subjectId: "nodejs",
    groupId: "kn-21",
    startsAt: "2026-10-24T10:00:00Z",
    room: "301",
    queueLimit: 10,
    labIds: ["nodejs-1"],
  });
  const { id } = created.json();
  await post("t-1", `/sessions/${id}/open`);
  for (const s of students) {
    await post(s, `/sessions/${id}/queue`, { labId: "nodejs-1" });
  }
  return id;
}

/** Блокування викладача t-1 з прямого з'єднання — команди застосунку чекають. */
async function holdTeacherLock() {
  const conn = await side.reserve();
  await conn`select pg_advisory_lock(hashtextextended('teacher:t-1', 0))`;
  return async () => {
    await conn`select pg_advisory_unlock(hashtextextended('teacher:t-1', 0))`;
    conn.release();
  };
}

test("обрив з'єднання посеред транзакції → повтор цілої транзакції → 200", async () => {
  const id = await sessionWith(["s-1"]);
  logs.length = 0;
  const release = await holdTeacherLock();
  const pending = post("t-1", `/sessions/${id}/queue/call-next`);
  await sleep(300); // застосунок уже в транзакції й чекає на блокування
  proxy.drop();
  await sleep(100);
  await release();
  const res = await pending;
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().studentId, "s-1");
  const retry = logs.find((l) => l.msg === "повтор транзакції");
  assert.ok(retry, "повтор не залоговано");
  assert.equal(retry.attempt, 1);
});

test("довше за statement_timeout (3 с) → 503 SOURCE_UNAVAILABLE з Retry-After, без повтору", async () => {
  const id = await sessionWith(["s-2"]);
  logs.length = 0;
  const release = await holdTeacherLock();
  const res = await post("t-1", `/sessions/${id}/queue/call-next`);
  await release();
  assert.equal(res.statusCode, 503, res.body);
  assert.equal(res.json().error.code, "SOURCE_UNAVAILABLE");
  assert.equal(res.headers["retry-after"], "1");
  assert.ok(!logs.some((l) => l.msg === "повтор транзакції"));
});

test("друга лінія: запис повз застосунок під гонкою → 23505 → 409 CONFLICT і помилка в лог", async () => {
  const id = await sessionWith([]);
  logs.length = 0;
  const conn = await side.reserve();
  await conn`begin`;
  await conn`
    insert into queue.entries (id, session_id, teacher_id, student_id, lab_id,
      status, seq, enqueued_at)
    values (${randomUUID()}, ${id}, 't-1', 's-4', 'nodejs-1', 'waiting', 99, now())`;
  const pending = post("s-4", `/sessions/${id}/queue`, { labId: "nodejs-1" });
  await sleep(300); // застосунок уже перевірив I1 і чекає на унікальному індексі
  await conn`commit`;
  conn.release();
  const res = await pending;
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, "CONFLICT");
  assert.ok(
    logs.some((l) => l.msg === "спрацювала друга лінія БД" && l.level === 50),
  );
});

test("БД недоступна → 503 на POST і GET, /ready 503, /health 200", async () => {
  const id = await sessionWith([]);
  await proxy.down();
  const write = await post("s-3", `/sessions/${id}/queue`, {
    labId: "nodejs-1",
  });
  assert.equal(write.statusCode, 503, write.body);
  assert.equal(write.json().error.code, "SOURCE_UNAVAILABLE");
  assert.equal(write.headers["retry-after"], "1");
  const read = await app.inject({
    url: "/sessions",
    headers: { "x-user-id": "s-3" },
  });
  assert.equal(read.statusCode, 503, read.body);
  assert.equal((await app.inject({ url: "/ready" })).statusCode, 503);
  assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
});

test("БД повернулась → /ready 200, запити знову працюють без перезапуску", async () => {
  await proxy.up();
  assert.equal((await app.inject({ url: "/ready" })).statusCode, 200);
  const id = await sessionWith(["s-3"]);
  const me = await app.inject({
    url: `/sessions/${id}/queue/me`,
    headers: { "x-user-id": "s-3" },
  });
  assert.equal(me.statusCode, 200, me.body);
});
