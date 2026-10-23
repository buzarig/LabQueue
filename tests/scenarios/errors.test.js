// Каталог помилок (К8): кожен код із data.md має сценарний тест, що отримує
// його з тим статусом, який записаний у data.md. Новий код у каталозі без
// тесту тут — падіння make check.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient, MISSING } from "./client.js";
import { parseErrorCatalog, uncoveredCodes } from "./error-catalog.js";

/** @typedef {Awaited<ReturnType<typeof createClient>>} C */

const catalog = parseErrorCatalog();

/**
 * Коди, які на статиці не виникають. Кожен — з місцем, де він перевіряється.
 * @type {Record<string, string>}
 */
const EXEMPT = {
  CONFLICT:
    "друга лінія — порушення унікального індексу 23505, є лише на PostgreSQL (крок БД)",
  SOURCE_UNAVAILABLE:
    "збій БД — лише на PostgreSQL, reports/lab2/failures.txt (крок БД)",
  INTERNAL: "непередбачена помилка — tests/unit/platform/server.test.js",
};

/** @param {C} c */
const session = (c) => c.openSession();

/** @type {Record<string, (c: C) => Promise<import("light-my-request").Response>>} */
const CASES = {
  async VALIDATION_FAILED(c) {
    return c.post("t-1", "/sessions", { subjectId: "nodejs" });
  },
  async UNAUTHENTICATED(c) {
    return c.app.inject({ url: "/sessions" });
  },
  async ROUTE_NOT_FOUND(c) {
    return c.get("s-1", "/no-such-route");
  },
  async FORBIDDEN_ROLE(c) {
    return c.post("s-1", "/sessions", {
      subjectId: "nodejs",
      groupId: "kn-21",
      startsAt: "2026-10-23T10:00:00Z",
      room: "1",
      queueLimit: 5,
      labIds: ["nodejs-1"],
    });
  },
  async NOT_SESSION_OWNER(c) {
    const { id } = await session(c);
    return c.post("t-2", `/sessions/${id}/close`);
  },
  async NOT_IN_GROUP(c) {
    const { id } = await session(c);
    return c.post("s-5", `/sessions/${id}/queue`, { labId: "nodejs-1" });
  },
  async NOT_ENTRY_OWNER(c) {
    const { id } = await session(c);
    const entry = await c.enqueue(id, "s-1");
    return c.post("s-2", `/entries/${entry.id}/leave`);
  },
  async SESSION_NOT_FOUND(c) {
    return c.post("t-1", `/sessions/${MISSING}/open`);
  },
  async ENTRY_NOT_FOUND(c) {
    return c.post("t-1", `/entries/${MISSING}/start`);
  },
  async NO_ACTIVE_ENTRY(c) {
    const { id } = await session(c);
    return c.get("s-1", `/sessions/${id}/queue/me`);
  },
  async UNKNOWN_REFERENCE(c) {
    return c.post("t-1", "/sessions", {
      subjectId: "nodejs",
      groupId: "kn-21",
      startsAt: "2026-10-23T10:00:00Z",
      room: "1",
      queueLimit: 5,
      labIds: ["db-1"],
    });
  },
  async SESSION_STATE_CONFLICT(c) {
    const { id } = await session(c);
    return c.post("t-1", `/sessions/${id}/open`);
  },
  async ENROLLMENT_CLOSED(c) {
    const { id } = await session(c);
    await c.post("t-1", `/sessions/${id}/close`);
    return c.post("s-1", `/sessions/${id}/queue`, { labId: "nodejs-1" });
  },
  async LAB_NOT_ACCEPTED(c) {
    const { id } = await session(c);
    return c.post("s-1", `/sessions/${id}/queue`, { labId: "nodejs-3" });
  },
  async QUEUE_LIMIT_REACHED(c) {
    const { id } = await c.openSession({ queueLimit: 1 });
    await c.enqueue(id, "s-1");
    return c.post("s-2", `/sessions/${id}/queue`, { labId: "nodejs-1" });
  },
  async ALREADY_IN_QUEUE(c) {
    const { id } = await session(c);
    await c.enqueue(id, "s-1");
    return c.post("s-1", `/sessions/${id}/queue`, { labId: "nodejs-2" });
  },
  async DROPPED_FROM_SESSION(c) {
    const { id } = await session(c);
    const entry = await c.enqueue(id, "s-1");
    for (let i = 0; i < 2; i++) {
      await c.post("t-1", `/sessions/${id}/queue/call-next`);
      await c.post("t-1", `/entries/${entry.id}/no-show`);
    }
    return c.post("s-1", `/sessions/${id}/queue`, { labId: "nodejs-1" });
  },
  async TEACHER_BUSY(c) {
    const { id } = await session(c);
    await c.enqueue(id, "s-1");
    await c.enqueue(id, "s-2");
    await c.post("t-1", `/sessions/${id}/queue/call-next`);
    return c.post("t-1", `/sessions/${id}/queue/call-next`);
  },
  async QUEUE_EMPTY(c) {
    const { id } = await session(c);
    return c.post("t-1", `/sessions/${id}/queue/call-next`);
  },
  async ENTRY_STATE_CONFLICT(c) {
    const { id } = await session(c);
    const entry = await c.enqueue(id, "s-1");
    return c.post("t-1", `/entries/${entry.id}/start`);
  },
  async SUBMITTING_IN_PROGRESS(c) {
    const { id } = await session(c);
    const entry = await c.enqueue(id, "s-1");
    await c.post("t-1", `/sessions/${id}/queue/call-next`);
    await c.post("t-1", `/entries/${entry.id}/start`);
    await c.post("t-1", `/sessions/${id}/close`);
    return c.post("t-1", `/sessions/${id}/finish`);
  },
  async SCORE_MISMATCH(c) {
    const { id } = await session(c);
    const entry = await c.enqueue(id, "s-1");
    await c.post("t-1", `/sessions/${id}/queue/call-next`);
    await c.post("t-1", `/entries/${entry.id}/start`);
    return c.post("t-1", `/entries/${entry.id}/result`, { outcome: "passed" });
  },
  async IDEMPOTENCY_KEY_REUSED(c) {
    const { id } = await session(c);
    await c.post(
      "s-1",
      `/sessions/${id}/queue`,
      { labId: "nodejs-1" },
      { key: "k" },
    );
    return c.post(
      "s-1",
      `/sessions/${id}/queue`,
      { labId: "nodejs-2" },
      { key: "k" },
    );
  },
};

test("К8: кожен код каталогу data.md має сценарний тест або обґрунтований виняток", () => {
  assert.deepEqual(
    uncoveredCodes(catalog, Object.keys(CASES), Object.keys(EXEMPT)),
    [],
  );
  for (const code of [...Object.keys(CASES), ...Object.keys(EXEMPT)]) {
    assert.ok(catalog.has(code), `${code} немає в каталозі data.md`);
  }
});

for (const [code, run] of Object.entries(CASES)) {
  test(`${code} → ${catalog.get(code)}`, async () => {
    const res = await run(await createClient());
    assert.equal(res.statusCode, catalog.get(code), res.body);
    assert.equal(res.json().error.code, code);
    assert.equal(typeof res.json().error.message, "string");
  });
}
