// Сценарна сюїта (К7): S1–S13 з architecture.md лаби 1 одним заняттям через
// HTTP, у порядку, в якому вони трапляються в житті. Тести йдуть послідовно
// й ділять стан — кожен наступний спирається на попередній.
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { createClient } from "./client.js";

describe("заняття від створення до історії здач (S1–S13)", () => {
  /** @type {Awaited<ReturnType<typeof createClient>>} */
  let c;
  /** @type {string} */
  let sessionId;
  /** @type {Record<string, string>} */
  const entries = {};

  before(async () => {
    c = await createClient();
  });

  test("S1. Викладач створює заняття", async () => {
    const session = c.expectStatus(
      await c.post("t-1", "/sessions", {
        subjectId: "nodejs",
        groupId: "kn-21",
        startsAt: "2026-10-23T10:00:00Z",
        room: "301",
        queueLimit: 3,
        labIds: ["nodejs-1", "nodejs-2"],
      }),
      201,
    );
    assert.equal(session.state, "planned");
    sessionId = session.id;
  });

  test("S2. Викладач відкриває запис", async () => {
    const res = c.expectStatus(
      await c.post("t-1", `/sessions/${sessionId}/open`),
      200,
    );
    assert.equal(res.state, "open");
  });

  test("S10. Студенти стають у чергу", async () => {
    for (const student of ["s-1", "s-2", "s-3"]) {
      entries[student] = (await c.enqueue(sessionId, student)).id;
    }
    c.expectStatus(
      await c.post("s-4", `/sessions/${sessionId}/queue`, {
        labId: "nodejs-1",
      }),
      409,
      "QUEUE_LIMIT_REACHED",
    );
  });

  test("S9. Студент бачить заняття своєї групи й стан черг", async () => {
    const [session] = c.expectStatus(await c.get("s-4", "/sessions"), 200);
    assert.equal(session.id, sessionId);
    assert.equal(session.waitingCount, 3);
    assert.equal(session.calledStudentId, null);
  });

  test("S11. Студент бачить свою позицію й орієнтовний час", async () => {
    const me = c.expectStatus(
      await c.get("s-3", `/sessions/${sessionId}/queue/me`),
      200,
    );
    assert.deepEqual(me, { status: "waiting", position: 3, etaMinutes: 30 });
  });

  test("S12. Студент виходить із черги", async () => {
    const res = c.expectStatus(
      await c.post("s-2", `/entries/${entries["s-2"]}/leave`),
      200,
    );
    assert.equal(res.status, "left");
    const me = c.expectStatus(
      await c.get("s-3", `/sessions/${sessionId}/queue/me`),
      200,
    );
    assert.equal(me.position, 2, "позиції зсунулися (I3)");
  });

  test("S5. Викладач викликає наступного", async () => {
    const called = c.expectStatus(
      await c.post("t-1", `/sessions/${sessionId}/queue/call-next`),
      200,
    );
    assert.equal(called.studentId, "s-1");
  });

  test("S8. Викладач позначає неявку — студент у кінець черги", async () => {
    const res = c.expectStatus(
      await c.post("t-1", `/entries/${entries["s-1"]}/no-show`),
      200,
    );
    assert.equal(res.status, "waiting");
    assert.equal(res.noShowCount, 1);
  });

  test("S6. Викладач починає прийом", async () => {
    const called = c.expectStatus(
      await c.post("t-1", `/sessions/${sessionId}/queue/call-next`),
      200,
    );
    assert.equal(called.studentId, "s-3", "s-1 після неявки — в кінці");
    const started = c.expectStatus(
      await c.post("t-1", `/entries/${called.id}/start`),
      200,
    );
    assert.equal(started.status, "submitting");
  });

  test("S7. Викладач фіксує результат", async () => {
    c.advance(6);
    const res = c.expectStatus(
      await c.post("t-1", `/entries/${entries["s-3"]}/result`, {
        outcome: "passed",
        score: 92,
      }),
      200,
    );
    assert.equal(res.status, "passed");
    const me = c.expectStatus(
      await c.get("s-1", `/sessions/${sessionId}/queue/me`),
      200,
    );
    assert.deepEqual(me, { status: "waiting", position: 1, etaMinutes: 6 });
  });

  test("S3. Викладач закриває запис — черга продовжує рухатись", async () => {
    c.expectStatus(await c.post("t-1", `/sessions/${sessionId}/close`), 200);
    c.expectStatus(
      await c.post("s-4", `/sessions/${sessionId}/queue`, {
        labId: "nodejs-1",
      }),
      409,
      "ENROLLMENT_CLOSED",
    );
    const called = c.expectStatus(
      await c.post("t-1", `/sessions/${sessionId}/queue/call-next`),
      200,
    );
    assert.equal(called.studentId, "s-1");
  });

  test("S4. Викладач завершує заняття — викликаний без здачі стає missed", async () => {
    const res = c.expectStatus(
      await c.post("t-1", `/sessions/${sessionId}/finish`),
      200,
    );
    assert.equal(res.state, "finished");
    assert.equal(res.missedCount, 1);
  });

  test("S13. Студент переглядає історію здач", async () => {
    const history = c.expectStatus(await c.get("s-3", "/me/history"), 200);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "passed");
    assert.equal(history[0].score, 92);
    assert.equal(history[0].labTitle, "Фундамент і структура");
    assert.deepEqual(
      c.expectStatus(await c.get("s-1", "/me/history"), 200),
      [],
    );
  });
});
