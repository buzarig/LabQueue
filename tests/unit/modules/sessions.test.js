// sessions: S1–S3 і API для queue — кожен перехід і кожен код помилки сценаріїв.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestApp, newSession } from "../helpers/app.js";

/** @param {Awaited<ReturnType<typeof createTestApp>>} t */
async function created(t, over = {}) {
  const res = await t.post("t-1", "/sessions", newSession(over));
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

test("S1: викладач створює заняття — 201, planned, власник — він", async () => {
  const t = await createTestApp();
  const session = await created(t, { labIds: ["nodejs-2", "nodejs-1"] });
  assert.equal(session.state, "planned");
  assert.equal(session.teacherId, "t-1");
  assert.equal(session.startsAt, "2026-10-23T10:00:00.000Z");
  assert.deepEqual(session.labIds, ["nodejs-1", "nodejs-2"]);
  assert.deepEqual(await t.sessions.getById(session.id), session);
});

test("S1: студент → 403 FORBIDDEN_ROLE", async () => {
  const t = await createTestApp();
  const res = await t.post("s-1", "/sessions", newSession());
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "FORBIDDEN_ROLE");
});

test("S1: тіло не за схемою → 400 VALIDATION_FAILED", async () => {
  const t = await createTestApp();
  const { subjectId, ...noSubject } = newSession();
  for (const body of [
    noSubject,
    newSession({ extra: 1 }),
    newSession({ queueLimit: 0 }),
    newSession({ queueLimit: "5" }),
    newSession({ labIds: [] }),
    newSession({ labIds: ["nodejs-1", "nodejs-1"] }),
    newSession({ startsAt: "завтра" }),
  ]) {
    const res = await t.post("t-1", "/sessions", body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.json().error.code, "VALIDATION_FAILED");
  }
  assert.ok(subjectId);
});

test("S1: невідомі предмет, група чи лаба, лаба з іншого предмета → 422 UNKNOWN_REFERENCE", async () => {
  const t = await createTestApp();
  for (const over of [
    { subjectId: "nope" },
    { groupId: "nope" },
    { labIds: ["nodejs-1", "nope"] },
    { labIds: ["nodejs-1", "db-1"] },
  ]) {
    const res = await t.post("t-1", "/sessions", newSession(over));
    assert.equal(res.statusCode, 422, JSON.stringify(over));
    assert.equal(res.json().error.code, "UNKNOWN_REFERENCE");
  }
  assert.deepEqual(await t.sessions.getByGroup("kn-21"), []);
});

test("S1: повтор з тим самим Idempotency-Key — те саме заняття, друге не створюється", async () => {
  const t = await createTestApp();
  const first = await t.post("t-1", "/sessions", newSession(), { key: "k-1" });
  const again = await t.post("t-1", "/sessions", newSession(), { key: "k-1" });
  assert.equal(again.statusCode, 201);
  assert.equal(again.json().id, first.json().id);
  assert.equal((await t.sessions.getByGroup("kn-21")).length, 1);
  const other = await t.post("t-1", "/sessions", newSession({ room: "1" }), {
    key: "k-1",
  });
  assert.equal(other.statusCode, 409);
  assert.equal(other.json().error.code, "IDEMPOTENCY_KEY_REUSED");
});

test("S2, S3: planned → open → closed → open", async () => {
  const t = await createTestApp();
  const { id } = await created(t);
  for (const [action, state] of [
    ["open", "open"],
    ["close", "closed"],
    ["open", "open"],
  ]) {
    const res = await t.post("t-1", `/sessions/${id}/${action}`);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().state, state);
  }
});

test("S2, S3: перехід не за діаграмою → 409 SESSION_STATE_CONFLICT", async () => {
  const t = await createTestApp();
  const { id } = await created(t);
  const closePlanned = await t.post("t-1", `/sessions/${id}/close`);
  assert.equal(closePlanned.statusCode, 409);
  assert.equal(closePlanned.json().error.code, "SESSION_STATE_CONFLICT");
  await t.post("t-1", `/sessions/${id}/open`);
  const openOpen = await t.post("t-1", `/sessions/${id}/open`);
  assert.equal(openOpen.statusCode, 409);
  assert.equal(openOpen.json().error.code, "SESSION_STATE_CONFLICT");
});

test("S2, S3: чуже заняття → 403 NOT_SESSION_OWNER; студент → 403 FORBIDDEN_ROLE", async () => {
  const t = await createTestApp();
  const { id } = await created(t);
  const other = await t.post("t-2", `/sessions/${id}/open`);
  assert.equal(other.statusCode, 403);
  assert.equal(other.json().error.code, "NOT_SESSION_OWNER");
  const student = await t.post("s-1", `/sessions/${id}/open`);
  assert.equal(student.statusCode, 403);
  assert.equal(student.json().error.code, "FORBIDDEN_ROLE");
});

test("S2, S3: немає заняття → 404 SESSION_NOT_FOUND раніше за 403; не uuid → 400", async () => {
  const t = await createTestApp();
  const missing = "00000000-0000-4000-8000-000000000000";
  for (const user of ["t-1", "s-1"]) {
    const res = await t.post(user, `/sessions/${missing}/open`);
    assert.equal(res.statusCode, 404, user);
    assert.equal(res.json().error.code, "SESSION_NOT_FOUND");
  }
  const bad = await t.post("t-1", "/sessions/abc/close");
  assert.equal(bad.statusCode, 400);
});

test("доменна відмова з ключем повторюється тією самою відмовою", async () => {
  const t = await createTestApp();
  const { id } = await created(t);
  const first = await t.post("t-1", `/sessions/${id}/close`, {}, { key: "c" });
  await t.post("t-1", `/sessions/${id}/open`);
  const again = await t.post("t-1", `/sessions/${id}/close`, {}, { key: "c" });
  assert.equal(first.statusCode, 409);
  assert.equal(again.statusCode, 409);
  assert.equal((await t.sessions.getById(id))?.state, "open");
});

test("API для queue: заняття групи за часом, пакетно за id, завершення лише з closed", async () => {
  const t = await createTestApp();
  const late = await created(t, { startsAt: "2026-10-24T10:00:00Z" });
  const early = await created(t, { startsAt: "2026-10-23T08:00:00Z" });
  await created(t, { groupId: "kn-22" });
  assert.deepEqual(
    (await t.sessions.getByGroup("kn-21")).map((s) => s.id),
    [early.id, late.id],
  );
  assert.deepEqual(
    (await t.sessions.getByIds([late.id, "nope", late.id])).map((s) => s.id),
    [late.id],
  );

  const finish = (/** @type {string} */ id) =>
    t.asUser("t-1", () => t.unitOfWork(() => t.sessions.markFinished(id)));
  await assert.rejects(finish(early.id), { code: "SESSION_STATE_CONFLICT" });
  await t.post("t-1", `/sessions/${early.id}/open`);
  await t.post("t-1", `/sessions/${early.id}/close`);
  assert.equal((await finish(early.id)).state, "finished");
  const reopen = await t.post("t-1", `/sessions/${early.id}/open`);
  assert.equal(reopen.statusCode, 409, "завершене — кінцевий стан (I10)");
});
