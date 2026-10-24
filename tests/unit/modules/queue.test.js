// queue: S10 і S5–S8 — кожен перехід, кожен код помилки цих сценаріїв,
// інваріанти I1–I9 і гонки на статиці.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestApp } from "../helpers/app.js";

/** @typedef {Awaited<ReturnType<typeof createTestApp>>} T */

/**
 * @param {T} t
 * @param {string} sessionId
 * @param {string} student
 * @param {string} [labId]
 */
const enqueue = (t, sessionId, student, labId = "nodejs-1") =>
  t.post(student, `/sessions/${sessionId}/queue`, { labId });

/** @param {import("light-my-request").Response} res @param {number} status @param {string} [code] */
function expect(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  if (code) assert.equal(res.json().error.code, code);
  return res.json();
}

test("S10: студенти стають у кінець черги — waiting, seq 1, 2", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const first = expect(await enqueue(t, id, "s-1"), 201);
  const second = expect(await enqueue(t, id, "s-2", "nodejs-2"), 201);
  assert.equal(first.status, "waiting");
  assert.equal(first.teacherId, "t-1");
  assert.deepEqual([first.seq, second.seq], [1, 2]);
  assert.equal(first.enqueuedAt, "2026-10-23T09:00:00.000Z");
});

test("S10: відмови — 404, 403 FORBIDDEN_ROLE, 403 NOT_IN_GROUP", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(
    await enqueue(t, "00000000-0000-4000-8000-000000000000", "s-1"),
    404,
    "SESSION_NOT_FOUND",
  );
  expect(await enqueue(t, id, "t-1"), 403, "FORBIDDEN_ROLE");
  expect(await enqueue(t, id, "s-5"), 403, "NOT_IN_GROUP");
});

test("S10: запис не відкритий (planned, closed) → 409 ENROLLMENT_CLOSED", async () => {
  const t = await createTestApp();
  const planned = expect(
    await t.post("t-1", "/sessions", {
      subjectId: "nodejs",
      groupId: "kn-21",
      startsAt: "2026-10-23T10:00:00Z",
      room: "1",
      queueLimit: 5,
      labIds: ["nodejs-1"],
    }),
    201,
  );
  expect(await enqueue(t, planned.id, "s-1"), 409, "ENROLLMENT_CLOSED");
  const { id } = await t.openSession();
  await t.post("t-1", `/sessions/${id}/close`);
  expect(await enqueue(t, id, "s-1"), 409, "ENROLLMENT_CLOSED");
});

test("S10: лаба не приймається → 409 LAB_NOT_ACCEPTED", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession({ labIds: ["nodejs-1"] });
  expect(await enqueue(t, id, "s-1", "nodejs-3"), 409, "LAB_NOT_ACCEPTED");
  expect(await enqueue(t, id, "s-1", "nope"), 409, "LAB_NOT_ACCEPTED");
});

test("S10: I1 — другий активний запис → 409 ALREADY_IN_QUEUE", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(await enqueue(t, id, "s-1"), 201);
  expect(await enqueue(t, id, "s-1", "nodejs-2"), 409, "ALREADY_IN_QUEUE");
});

test("S10: I2 — ліміт активних записів → 409 QUEUE_LIMIT_REACHED", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession({ queueLimit: 2 });
  expect(await enqueue(t, id, "s-1"), 201);
  expect(await enqueue(t, id, "s-2"), 201);
  expect(await enqueue(t, id, "s-3"), 409, "QUEUE_LIMIT_REACHED");
});

test("S10: гонка — 4 одночасні записи при ліміті 2: рівно 2 успіхи, seq без дублів", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession({ queueLimit: 2 });
  const results = await Promise.all(
    ["s-1", "s-2", "s-3", "s-4"].map((s) => enqueue(t, id, s)),
  );
  const ok = results
    .filter((r) => r.statusCode === 201)
    .map((r) => r.json().seq);
  assert.deepEqual(ok.sort(), [1, 2]);
  assert.equal(results.filter((r) => r.statusCode === 409).length, 2);
});

test("S5: викликає першого за seq; порожня черга → 409 QUEUE_EMPTY", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(
    await t.post("t-1", `/sessions/${id}/queue/call-next`),
    409,
    "QUEUE_EMPTY",
  );
  expect(await enqueue(t, id, "s-2"), 201);
  expect(await enqueue(t, id, "s-1"), 201);
  t.advance(60_000);
  const called = expect(
    await t.post("t-1", `/sessions/${id}/queue/call-next`),
    200,
  );
  assert.equal(called.studentId, "s-2");
  assert.equal(called.status, "called");
  assert.equal(called.calledAt, "2026-10-23T09:01:00.000Z");
});

test("S5: I4 — у викладача вже є викликаний, навіть на іншому занятті → 409 TEACHER_BUSY", async () => {
  const t = await createTestApp();
  const a = await t.openSession();
  const b = await t.openSession({ groupId: "kn-22" });
  expect(await enqueue(t, a.id, "s-1"), 201);
  expect(await enqueue(t, b.id, "s-5"), 201);
  expect(await t.post("t-1", `/sessions/${a.id}/queue/call-next`), 200);
  expect(
    await t.post("t-1", `/sessions/${b.id}/queue/call-next`),
    409,
    "TEACHER_BUSY",
  );
});

test("S5: подвійний клік з одним Idempotency-Key — той самий викликаний, а не TEACHER_BUSY", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  expect(await enqueue(t, id, "s-1"), 201);
  expect(await enqueue(t, id, "s-2"), 201);
  const url = `/sessions/${id}/queue/call-next`;
  const [one, two] = await Promise.all([
    t.post("t-1", url, {}, { key: "click" }),
    t.post("t-1", url, {}, { key: "click" }),
  ]);
  assert.equal(expect(one, 200).id, expect(two, 200).id);
});

test("S5–S8: чуже заняття → 403 NOT_SESSION_OWNER, студент → 403 FORBIDDEN_ROLE, немає запису → 404", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  expect(
    await t.post("t-2", `/sessions/${id}/queue/call-next`),
    403,
    "NOT_SESSION_OWNER",
  );
  expect(
    await t.post("s-1", `/sessions/${id}/queue/call-next`),
    403,
    "FORBIDDEN_ROLE",
  );
  for (const action of ["start", "no-show"]) {
    expect(
      await t.post("t-2", `/entries/${entry.id}/${action}`),
      403,
      "NOT_SESSION_OWNER",
    );
    expect(
      await t.post(
        "t-1",
        `/entries/00000000-0000-4000-8000-000000000000/${action}`,
      ),
      404,
      "ENTRY_NOT_FOUND",
    );
  }
});

test("S6, S7: called → submitting → passed з балом; після результату I4 відпускає", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  expect(await enqueue(t, id, "s-2"), 201);
  expect(await t.post("t-1", `/sessions/${id}/queue/call-next`), 200);
  const started = expect(
    await t.post("t-1", `/entries/${entry.id}/start`),
    200,
  );
  assert.equal(started.status, "submitting");
  const done = expect(
    await t.post("t-1", `/entries/${entry.id}/result`, {
      outcome: "passed",
      score: 90,
    }),
    200,
  );
  assert.equal(done.status, "passed");
  assert.equal(done.score, 90);
  assert.ok(done.finishedAt);
  const next = expect(
    await t.post("t-1", `/sessions/${id}/queue/call-next`),
    200,
  );
  assert.equal(next.studentId, "s-2");
});

test("S6, S7: перехід не за діаграмою → 409 ENTRY_STATE_CONFLICT", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  expect(
    await t.post("t-1", `/entries/${entry.id}/start`),
    409,
    "ENTRY_STATE_CONFLICT",
  );
  expect(
    await t.post("t-1", `/entries/${entry.id}/result`, { outcome: "rework" }),
    409,
    "ENTRY_STATE_CONFLICT",
  );
});

test("S7: I9 — бал лише в passed (422 SCORE_MISMATCH), поза 0–100 → 400", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  await t.post("t-1", `/entries/${entry.id}/start`);
  const url = `/entries/${entry.id}/result`;
  expect(
    await t.post("t-1", url, { outcome: "passed" }),
    422,
    "SCORE_MISMATCH",
  );
  expect(
    await t.post("t-1", url, { outcome: "rework", score: 50 }),
    422,
    "SCORE_MISMATCH",
  );
  expect(
    await t.post("t-1", url, { outcome: "passed", score: 101 }),
    400,
    "VALIDATION_FAILED",
  );
  const rework = expect(await t.post("t-1", url, { outcome: "rework" }), 200);
  assert.equal(rework.status, "rework");
  assert.equal(rework.score, null);
});

test("S8: перша неявка — у кінець черги, друга — dropped; потім запис → 409 DROPPED_FROM_SESSION", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  expect(await enqueue(t, id, "s-2"), 201);
  const callNext = () => t.post("t-1", `/sessions/${id}/queue/call-next`);

  expect(await callNext(), 200);
  const first = expect(
    await t.post("t-1", `/entries/${entry.id}/no-show`),
    200,
  );
  assert.equal(first.status, "waiting");
  assert.equal(first.noShowCount, 1);
  assert.equal(first.seq, 3, "у кінець: після s-2 (seq 2)");

  const s2 = expect(await callNext(), 200);
  assert.equal(s2.studentId, "s-2", "s-2 тепер перший");
  await t.post("t-1", `/entries/${s2.id}/start`);
  await t.post("t-1", `/entries/${s2.id}/result`, { outcome: "rework" });

  expect(await callNext(), 200);
  const second = expect(
    await t.post("t-1", `/entries/${entry.id}/no-show`),
    200,
  );
  assert.equal(second.status, "dropped");
  assert.equal(second.noShowCount, 2);
  assert.ok(second.finishedAt);

  expect(await enqueue(t, id, "s-1"), 409, "DROPPED_FROM_SESSION");
});

test("S8: неявка лише з called → інакше 409 ENTRY_STATE_CONFLICT; I4 відпускає після неявки", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  expect(
    await t.post("t-1", `/entries/${entry.id}/no-show`),
    409,
    "ENTRY_STATE_CONFLICT",
  );
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  await t.post("t-1", `/entries/${entry.id}/no-show`);
  const again = expect(
    await t.post("t-1", `/sessions/${id}/queue/call-next`),
    200,
  );
  assert.equal(again.id, entry.id, "єдиний в черзі — знову він");
});

test("S10: повторний запис після rework — у кінець, лічильник неявок зберігається", async () => {
  const t = await createTestApp();
  const { id } = await t.openSession();
  const entry = expect(await enqueue(t, id, "s-1"), 201);
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  await t.post("t-1", `/entries/${entry.id}/no-show`);
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  await t.post("t-1", `/entries/${entry.id}/start`);
  await t.post("t-1", `/entries/${entry.id}/result`, { outcome: "rework" });
  const again = expect(await enqueue(t, id, "s-1", "nodejs-2"), 201);
  assert.notEqual(again.id, entry.id, "новий запис");
  await t.post("t-1", `/sessions/${id}/queue/call-next`);
  const dropped = expect(
    await t.post("t-1", `/entries/${again.id}/no-show`),
    200,
  );
  assert.equal(
    dropped.status,
    "dropped",
    "друга неявка на парі (студент, заняття)",
  );
});
