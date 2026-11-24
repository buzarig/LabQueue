// Сумісність структурної міграції зі старою версією (spec лаби 4, критерій 8;
// ADR-0044): після 002-sessions-created-at запит вставки заняття з явним
// переліком колонок — той, що виконує версія до міграції, — працює, а
// created_at заповнює БД. Ручний сценарій на staging (Rollback) — аудит.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { migrate } from "../../scripts/migrate.js";
import { createTestDb } from "./harness.js";

/** @type {Awaited<ReturnType<typeof createTestDb>>} */
let db;
/** @type {import("postgres").Sql} */
let sql;

before(async () => {
  db = await createTestDb({ empty: true });
  sql = db.connect();
  await migrate(sql);
});

after(async () => {
  await sql?.end();
  await db?.drop();
});

test("вставка старої версії (без created_at) після 002 — БД ставить created_at", async () => {
  const id = randomUUID();
  // Дослівно колонки з repo-pg.js сесій до міграції 002.
  await sql`
    insert into sessions.sessions
      (id, subject_id, group_id, teacher_id, starts_at, room, queue_limit, state)
    values (${id}, 'nodejs', 'kn-21', 't-1', now(), '301', 5, 'planned')`;
  const [row] = await sql`
    select created_at from sessions.sessions where id = ${id}`;
  assert.ok(row.created_at instanceof Date);
  assert.ok(Math.abs(Date.now() - row.created_at.getTime()) < 60_000);
});
