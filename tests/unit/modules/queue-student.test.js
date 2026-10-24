// queue: S4, S9, S11, S12, S13 — завершення заняття, стан черг, позиція й
// орієнтовний час, вихід, історія; пакетні виклики без N+1.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestApp } from "../helpers/app.js";

/** @typedef {Awaited<ReturnType<typeof createTestApp>>} T */

/** @param {import("light-my-request").Response} res @param {number} status @param {string} [code] */
function expect(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  if (code) assert.equal(res.json().error.code, code);
  return res.json();
}

/** @param {T} t @param {string} id @param {string} student @param {string} [labId] */
const enqueue = async (t, id, student, labId = "nodejs-1") =>
  expect(await t.post(student, `/sessions/${id}/queue`, { labId }), 201);

/**
 * Повна здача: виклик → прийом → результат, із заданою тривалістю.
 * @param {T} t @param {string} sessionId @param {number} minutes
 * @param {{ outcome?: "passed" | "rework", score?: number }} [result]
 */
async function serveNext(
  t,
  sessionId,
  minutes,
  result = { outcome: "passed", score: 80 },
) {
  const called = expect(
    await t.post("t-1", `/sessions/${sessionId}/queue/call-next`),
    200,
  );
  expect(await t.post("t-1", `/entries/${called.id}/start`), 200);
  t.advance(minutes * 60_000);
  return expect(
    await t.post("t-1", `/entries/${called.id}/result`, result),
    200,
  );
}

test("S4: closed без submitting → finished, waiting і called → missed; потім запис неможливий", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  await enqueue(t, id, "s-1");
  await enqueue(t, id, "s-2");
  await enqueue(t, id, "s-3");
  await serveNext(t, id, 5);
  expect(await t.post("t-1", `/sessions/${id}/queue/call-next`), 200);
  expect(await t.post("t-1", `/sessions/${id}/close`), 200);
  const done = expect(await t.post("t-1", `/sessions/${id}/finish`), 200);
  assert.equal(done.state, "finished");
  assert.equal(done.missedCount, 2, "один called + один waiting");
  expect(
    await t.get("s-2", `/sessions/${id}/queue/me`),
    404,
    "NO_ACTIVE_ENTRY",
  );
  expect(
    await t.post("t-1", `/sessions/${id}/open`),
    409,
    "SESSION_STATE_CONFLICT",
  );
});

test("S4: є submitting → 409 SUBMITTING_IN_PROGRESS; не closed → 409 SESSION_STATE_CONFLICT", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(
    await t.post("t-1", `/sessions/${id}/finish`),
    409,
    "SESSION_STATE_CONFLICT",
  );
  const entry = await enqueue(t, id, "s-1");
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  await t.post("t-1", `/entries/${entry.id}/start`);
  await t.post("t-1", `/sessions/${id}/close`);
  expect(
    await t.post("t-1", `/sessions/${id}/finish`),
    409,
    "SUBMITTING_IN_PROGRESS",
  );
});

test("S4: чуже заняття → 403 NOT_SESSION_OWNER, студент → 403, немає → 404", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(
    await t.post("t-2", `/sessions/${id}/finish`),
    403,
    "NOT_SESSION_OWNER",
  );
  expect(await t.post("s-1", `/sessions/${id}/finish`), 403, "FORBIDDEN_ROLE");
  expect(
    await t.post(
      "t-1",
      "/sessions/00000000-0000-4000-8000-000000000000/finish",
    ),
    404,
    "SESSION_NOT_FOUND",
  );
});

test("S9: студент бачить лише заняття своєї групи зі станом черг", async () => {
  const t = await createTestApp();
  const a = await t.openSession({ startsAt: "2026-10-23T08:00:00Z" });
  const b = await t.openSession({ startsAt: "2026-10-23T12:00:00Z" });
  await t.openSession({ groupId: "kn-22" });
  await enqueue(t, a.id, "s-1");
  await enqueue(t, a.id, "s-2");
  await t.post("t-1", `/sessions/${a.id}/queue/call-next`);
  const list = expect(await t.get("s-3", "/sessions"), 200);
  assert.deepEqual(
    list.map((/** @type {any} */ s) => [
      s.id,
      s.waitingCount,
      s.calledStudentId,
    ]),
    [
      [a.id, 1, "s-1"],
      [b.id, 0, null],
    ],
  );
  expect(await t.get("t-1", "/sessions"), 403, "FORBIDDEN_ROLE");
});

test("S11: позиція — ранг серед waiting; без здач ETA = позиція × 10 хв", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  for (const s of ["s-1", "s-2", "s-3"]) await enqueue(t, id, s);
  assert.deepEqual(
    expect(await t.get("s-3", `/sessions/${id}/queue/me`), 200),
    {
      status: "waiting",
      position: 3,
      etaMinutes: 30,
    },
  );
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  assert.deepEqual(
    expect(await t.get("s-1", `/sessions/${id}/queue/me`), 200),
    {
      status: "called",
      position: null,
      etaMinutes: null,
    },
  );
  assert.equal(
    expect(await t.get("s-3", `/sessions/${id}/queue/me`), 200).position,
    2,
    "позиції без дірок (I3)",
  );
});

test("S11: ETA — позиція × середня тривалість останніх 5 здач, з округленням угору", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession({ queueLimit: 20 });
  const students = ["s-1", "s-2", "s-3", "s-4"];
  for (const s of students) await enqueue(t, id, s);
  await serveNext(t, id, 4);
  await serveNext(t, id, 7, { outcome: "rework" });
  // s-3 тепер перший: 1 × (4 + 7) / 2 = 5.5 → 6
  assert.equal(
    expect(await t.get("s-3", `/sessions/${id}/queue/me`), 200).etaMinutes,
    6,
  );
  // s-4 другий: 2 × 5.5 = 11
  assert.equal(
    expect(await t.get("s-4", `/sessions/${id}/queue/me`), 200).etaMinutes,
    11,
  );
});

test("S11: вибірка — лише 5 останніх здач, неявки не входять", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession({ queueLimit: 20 });
  const ids = ["s-1", "s-2", "s-3", "s-4"];
  for (const s of ids) await enqueue(t, id, s);
  // s-1: неявка (не входить у вибірку), потім у кінець
  const first = expect(
    await t.post("t-1", `/sessions/${id}/queue/call-next`),
    200,
  );
  t.advance(60 * 60_000);
  await t.post("t-1", `/entries/${first.id}/no-show`);
  await serveNext(t, id, 10);
  assert.equal(
    expect(await t.get("s-3", `/sessions/${id}/queue/me`), 200).etaMinutes,
    10,
    "година очікування неявки не врахована",
  );
});

test("S11: відмови — 404 NO_ACTIVE_ENTRY, 403 NOT_IN_GROUP, 403 FORBIDDEN_ROLE", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(
    await t.get("s-1", `/sessions/${id}/queue/me`),
    404,
    "NO_ACTIVE_ENTRY",
  );
  expect(await t.get("s-5", `/sessions/${id}/queue/me`), 403, "NOT_IN_GROUP");
  expect(await t.get("t-1", `/sessions/${id}/queue/me`), 403, "FORBIDDEN_ROLE");
});

test("S12: вихід лише з waiting, лише зі свого запису; позиції інших зсуваються", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const first = await enqueue(t, id, "s-1");
  await enqueue(t, id, "s-2");
  expect(
    await t.post("s-2", `/entries/${first.id}/leave`),
    403,
    "NOT_ENTRY_OWNER",
  );
  expect(
    await t.post("t-1", `/entries/${first.id}/leave`),
    403,
    "FORBIDDEN_ROLE",
  );
  const left = expect(await t.post("s-1", `/entries/${first.id}/leave`), 200);
  assert.equal(left.status, "left");
  assert.equal(
    expect(await t.get("s-2", `/sessions/${id}/queue/me`), 200).position,
    1,
  );
  expect(
    await t.post("s-1", `/entries/${first.id}/leave`),
    409,
    "ENTRY_STATE_CONFLICT",
  );
  const called = expect(
    await t.post("t-1", `/sessions/${id}/queue/call-next`),
    200,
  );
  expect(
    await t.post("s-2", `/entries/${called.id}/leave`),
    409,
    "ENTRY_STATE_CONFLICT",
    // викликаний не може вийти замість неявки (sf-13)
  );
  expect(
    await t.post("s-1", "/entries/00000000-0000-4000-8000-000000000000/leave"),
    404,
    "ENTRY_NOT_FOUND",
  );
});

test("S13: історія — лише passed і rework, з датою, предметом, лабою, балом", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  await enqueue(t, id, "s-1");
  await serveNext(t, id, 5, { outcome: "rework" });
  await enqueue(t, id, "s-1", "nodejs-2");
  await serveNext(t, id, 5, { outcome: "passed", score: 95 });
  const extra = await enqueue(t, id, "s-1");
  await t.post("s-1", `/entries/${extra.id}/leave`);
  const history = expect(await t.get("s-1", "/me/history"), 200);
  assert.deepEqual(
    history.map((/** @type {any} */ h) => [
      h.labTitle,
      h.status,
      h.score,
      h.subjectName,
    ]),
    [
      ["Сценарії і БД", "passed", 95, "Node.js"],
      ["Фундамент і структура", "rework", null, "Node.js"],
    ],
  );
  assert.equal(history[0].startsAt, "2026-10-23T10:00:00.000Z");
  assert.deepEqual(
    expect(await t.get("s-2", "/me/history"), 200),
    [],
    "лише власна (I11)",
  );
  expect(await t.get("t-1", "/me/history"), 403, "FORBIDDEN_ROLE");
});

test("без N+1: S9 і S13 кличуть sessions і catalog однаково при 1 і 4 заняттях", async () => {
  /** @param {number} n */
  async function callsFor(n) {
    const t = await createTestApp();
    for (let i = 0; i < n; i++) {
      const { id } = await t.openSession({
        startsAt: `2026-10-2${i}T10:00:00Z`,
      });
      await enqueue(t, id, "s-1");
      await serveNext(t, id, 5);
    }
    t.calls.clear();
    expect(await t.get("s-1", "/sessions"), 200);
    expect(await t.get("s-1", "/me/history"), 200);
    return Object.fromEntries(t.calls);
  }
  const one = await callsFor(1);
  assert.deepEqual(await callsFor(4), one);
  assert.deepEqual(one, {
    "sessions.getByGroup": 1,
    "sessions.getByIds": 1,
    "catalog.subjectsByIds": 1,
    "catalog.labsByIds": 1,
  });
});
