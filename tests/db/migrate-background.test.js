// Фонові міграції (spec лаби 4, критерії 9–10; ADR-0044) на справжньому
// PostgreSQL: дані пакетами до 100 рядків, індекс CONCURRENTLY поза
// транзакцією, журнал без повторів, одна копія за раз, відновлення після
// невалідного індексу.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { migrateBackground } from "../../scripts/migrate-background.js";
import { migrate } from "../../scripts/migrate.js";
import { createTestDb } from "./harness.js";

const NAMES = ["data/001-trim-room.sql", "indexes/001-entries-eta.sql"];

/** Порожня БД зі структурними міграціями. */
async function freshDb() {
  const db = await createTestDb({ empty: true });
  const sql = db.connect();
  await migrate(sql);
  return { db, sql };
}

/**
 * @param {import("postgres").Sql} sql
 * @param {number} n
 * @param {string} room
 */
async function insertSessions(sql, n, room) {
  const rows = Array.from({ length: n }, () => ({
    id: randomUUID(),
    subject_id: "nodejs",
    group_id: "kn-21",
    teacher_id: "t-1",
    starts_at: new Date("2026-11-24T10:00:00Z"),
    room,
    queue_limit: 10,
  }));
  await sql`insert into sessions.sessions ${sql(rows)}`;
}

/** @param {import("postgres").Sql} sql */
const etaIndex = async (sql) =>
  (
    await sql`
      select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as def
      from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relname = 'entries_eta'`
  )[0];

describe("фонові міграції на одній БД", () => {
  /** @type {Awaited<ReturnType<typeof freshDb>>} */
  let t;
  /** @type {string[]} */
  const log = [];
  before(async () => {
    t = await freshDb();
    await insertSessions(t.sql, 250, "  101  ");
    await insertSessions(t.sql, 5, "202");
  });
  after(async () => {
    await t.sql.end();
    await t.db.drop();
  });

  test("дані — пакетами 100, 100, 50; індекс — валідний і частковий", async () => {
    const applied = await migrateBackground(t.sql, {
      log: (line) => log.push(line),
    });
    assert.deepEqual(applied, NAMES);
    assert.deepEqual(
      log.filter((l) => l.includes("пакет")).map((l) => l.split(": ").at(-1)),
      ["100", "100", "50"],
    );
    const rooms = await t.sql`
      select room, count(*)::int as n from sessions.sessions
      group by room order by room`;
    assert.deepEqual(
      rooms.map((r) => [r.room, r.n]),
      [
        ["101", 250],
        ["202", 5],
      ],
    );
    const index = await etaIndex(t.sql);
    assert.equal(index.valid, true);
    assert.match(index.def, /\(session_id, finished_at DESC\)/);
    assert.match(index.def, /WHERE .*passed.*rework/);
  });

  test("повторний запуск — нічого: кроки в журналі", async () => {
    assert.deepEqual(await migrateBackground(t.sql, { log: () => {} }), []);
    const rows = await t.sql`
      select name from public.schema_migrations order by name`;
    assert.deepEqual(
      rows.map((r) => r.name),
      ["001-schema.sql", "002-sessions-created-at.sql", ...NAMES],
    );
  });
});

describe("дві копії одночасно (стара й нова версія під час деплою)", () => {
  /** @type {Awaited<ReturnType<typeof freshDb>>} */
  let t;
  before(async () => {
    t = await freshDb();
  });
  after(async () => {
    await t.sql.end();
    await t.db.drop();
  });

  test("кожен крок виконано рівно раз", async () => {
    const [a, b] = await Promise.all([
      migrateBackground(t.sql, { log: () => {} }),
      migrateBackground(t.sql, { log: () => {} }),
    ]);
    assert.deepEqual([...a, ...b].sort(), NAMES);
  });
});

describe("перерваний CREATE INDEX CONCURRENTLY", () => {
  /** @type {Awaited<ReturnType<typeof freshDb>>} */
  let t;
  before(async () => {
    t = await freshDb();
    // Невалідний entries_eta: унікальний індекс на дублікатах падає, а
    // CONCURRENTLY лишає по собі невалідний індекс — як після обриву.
    const session = randomUUID();
    for (const [student, seq] of [
      ["s-1", 1],
      ["s-2", 2],
    ]) {
      await t.sql`
        insert into queue.entries
          (id, session_id, teacher_id, student_id, lab_id, status, seq,
           enqueued_at, finished_at, score)
        values (${randomUUID()}, ${session}, 't-1', ${student}, 'nodejs-1',
          'passed', ${seq}, now(), now(), 90)`;
    }
    await t.sql
      .unsafe(
        "create unique index concurrently entries_eta on queue.entries (session_id)",
      )
      .catch(() => {});
    assert.equal((await etaIndex(t.sql)).valid, false);
  });
  after(async () => {
    await t.sql.end();
    await t.db.drop();
  });

  test("невалідний індекс видаляється й створюється правильний", async () => {
    /** @type {string[]} */
    const log = [];
    await migrateBackground(t.sql, { log: (line) => log.push(line) });
    assert.ok(log.some((l) => l.includes("невалідний entries_eta видалено")));
    const index = await etaIndex(t.sql);
    assert.equal(index.valid, true);
    assert.match(index.def, /\(session_id, finished_at DESC\)/);
  });
});
