// К11: паралельні запити на справжньому PostgreSQL не порушують I1–I4 —
// блокування за викладачем (ADR-0022) серіалізує команди, а унікальні
// індекси лишаються другою лінією (ADR-0002, ADR-0029).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createApp } from "../../src/main.js";
import { createTestDb } from "./harness.js";

/** @type {Awaited<ReturnType<typeof createTestDb>>} */
let db;
/** @type {Awaited<ReturnType<typeof createApp>>} */
let app;
/** @type {import("postgres").Sql} */
let sql;
const EXTRA = Array.from({ length: 20 }, (_, i) => `s-c${i + 1}`);

before(async () => {
  db = await createTestDb();
  sql = db.connect();
  // 20 додаткових студентів КН-21 — seed має лише чотирьох.
  for (const id of EXTRA) {
    await sql`
      insert into identity.users (id, name, role, group_id)
      values (${id}, ${`Студент ${id}`}, 'student', 'kn-21')`;
  }
  app = await createApp({ storage: "pg", databaseUrl: db.url, logger: false });
});
after(async () => {
  await app.close();
  await sql.end();
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

/** Заняття t-1 з відкритим записом. @param {Record<string, unknown>} over */
async function openSession(over = {}) {
  const created = await post("t-1", "/sessions", {
    subjectId: "nodejs",
    groupId: "kn-21",
    startsAt: "2026-10-24T10:00:00Z",
    room: "301",
    queueLimit: 50,
    labIds: ["nodejs-1"],
    ...over,
  });
  const { id } = created.json();
  await post("t-1", `/sessions/${id}/open`);
  return id;
}

/** @param {Array<{ statusCode: number, json: () => any }>} results */
const codes = (results) =>
  results.map((r) => (r.statusCode < 300 ? r.statusCode : r.json().error.code));

test("I2, I3: 20 одночасних записів при ліміті 5 — рівно 5, seq 1–5 без повторів", async () => {
  const id = await openSession({ queueLimit: 5 });
  const results = await Promise.all(
    EXTRA.map((student) =>
      post(student, `/sessions/${id}/queue`, { labId: "nodejs-1" }),
    ),
  );
  const seen = codes(results);
  assert.equal(seen.filter((c) => c === 201).length, 5, seen.join(" "));
  assert.equal(seen.filter((c) => c === "QUEUE_LIMIT_REACHED").length, 15);
  const rows = await sql`
    select seq from queue.entries where session_id = ${id} order by seq`;
  assert.deepEqual(
    rows.map((r) => r.seq),
    [1, 2, 3, 4, 5],
  );
});

test("I1: той самий студент двічі одночасно — один запис, другий 409 ALREADY_IN_QUEUE", async () => {
  const id = await openSession();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      post("s-1", `/sessions/${id}/queue`, { labId: "nodejs-1" }),
    ),
  );
  const seen = codes(results);
  assert.equal(seen.filter((c) => c === 201).length, 1, seen.join(" "));
  assert.equal(seen.filter((c) => c === "ALREADY_IN_QUEUE").length, 4);
  const [{ n }] = await sql`
    select count(*)::int as n from queue.entries
    where session_id = ${id} and student_id = 's-1'`;
  assert.equal(n, 1);
});

test("I4: «викликати наступного» одночасно на двох заняттях викладача — один виклик", async () => {
  const a = await openSession({ startsAt: "2026-10-25T10:00:00Z" });
  const b = await openSession({ startsAt: "2026-10-26T10:00:00Z" });
  await post("s-2", `/sessions/${a}/queue`, { labId: "nodejs-1" });
  await post("s-3", `/sessions/${b}/queue`, { labId: "nodejs-1" });
  const results = await Promise.all([
    post("t-1", `/sessions/${a}/queue/call-next`),
    post("t-1", `/sessions/${b}/queue/call-next`),
  ]);
  assert.deepEqual(codes(results).sort(), [200, "TEACHER_BUSY"].sort());
  const [{ n }] = await sql`
    select count(*)::int as n from queue.entries
    where teacher_id = 't-1' and status in ('called', 'submitting')`;
  assert.equal(n, 1);
});

test("I6: закриття запису одночасно з записами — після закриття жодного нового запису", async () => {
  const id = await openSession();
  const students = EXTRA.slice(0, 10);
  const enqueues = students.map((student) =>
    post(student, `/sessions/${id}/queue`, { labId: "nodejs-1" }),
  );
  const close = post("t-1", `/sessions/${id}/close`);
  const results = await Promise.all([...enqueues, close]);
  const seen = codes(results.slice(0, -1));
  assert.ok(
    seen.every((c) => c === 201 || c === "ENROLLMENT_CLOSED"),
    seen.join(" "),
  );
  const [{ n }] = await sql`
    select count(*)::int as n from queue.entries where session_id = ${id}`;
  assert.equal(n, seen.filter((c) => c === 201).length);
  const late = await post(EXTRA[19], `/sessions/${id}/queue`, {
    labId: "nodejs-1",
  });
  assert.equal(late.json().error.code, "ENROLLMENT_CLOSED");
});
