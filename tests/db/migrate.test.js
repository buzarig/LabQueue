// Міграції (К17, ADR-0026) і обмеження схеми як друга лінія (ADR-0002,
// ADR-0029) на справжньому PostgreSQL.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { migrate } from "../../scripts/migrate.js";
import { seed } from "../../scripts/seed.js";
import { createTestDb } from "./harness.js";

describe("ранер міграцій на порожній базі", () => {
  /** @type {Awaited<ReturnType<typeof createTestDb>>} */
  let db;
  /** @type {import("postgres").Sql} */
  let sql;
  before(async () => {
    db = await createTestDb({ empty: true });
    sql = db.connect();
  });
  after(async () => {
    await sql.end();
    await db.drop();
  });

  test("два одночасні запуски застосовують кожну міграцію рівно один раз", async () => {
    const [a, b] = await Promise.all([migrate(sql), migrate(sql)]);
    assert.deepEqual([...a, ...b], ["001-schema.sql"]);
    const rows = await sql`select name from public.schema_migrations`;
    assert.deepEqual(
      rows.map((r) => r.name),
      ["001-schema.sql"],
    );
  });

  test("повторний запуск нічого не змінює", async () => {
    assert.deepEqual(await migrate(sql), []);
  });

  test("seed повторюваний: двічі — ті самі 7 користувачів і 5 лаб", async () => {
    await seed(sql);
    await seed(sql);
    const [{ users }] =
      await sql`select count(*)::int as users from identity.users`;
    const [{ labs }] =
      await sql`select count(*)::int as labs from catalog.labs`;
    assert.deepEqual([users, labs], [7, 5]);
  });
});

describe("обмеження схеми — друга лінія", () => {
  /** @type {Awaited<ReturnType<typeof createTestDb>>} */
  let db;
  /** @type {import("postgres").Sql} */
  let sql;
  const session = "00000000-0000-4000-8000-000000000001";
  /** @param {Record<string, unknown>} over */
  const entry = (over) => ({
    id: crypto.randomUUID(),
    session_id: session,
    teacher_id: "t-1",
    student_id: "s-1",
    lab_id: "nodejs-1",
    status: "waiting",
    seq: 1,
    enqueued_at: new Date(),
    score: null,
    ...over,
  });
  /** @param {Record<string, unknown>} row */
  const insert = (row) => sql`insert into queue.entries ${sql(row)}`;

  before(async () => {
    db = await createTestDb();
    sql = db.connect();
  });
  after(async () => {
    await sql.end();
    await db.drop();
  });

  test("шаблон містить схему й seed", async () => {
    const [{ n }] = await sql`select count(*)::int as n from identity.users`;
    assert.equal(n, 7);
  });

  test("I9: бал лише в passed і в межах 0–100", async () => {
    await assert.rejects(insert(entry({ status: "passed", seq: 1 })), {
      code: "23514",
    });
    await assert.rejects(insert(entry({ score: 50, seq: 2 })), {
      code: "23514",
    });
    await assert.rejects(
      insert(entry({ status: "passed", score: 101, seq: 3 })),
      { code: "23514" },
    );
  });

  test("I1: другий активний запис студента на занятті — 23505", async () => {
    await insert(entry({ seq: 10 }));
    await assert.rejects(insert(entry({ seq: 11, status: "called" })), {
      code: "23505",
    });
    await insert(entry({ seq: 12, status: "left" }));
  });

  test("I3: однаковий seq на занятті — 23505", async () => {
    await assert.rejects(insert(entry({ student_id: "s-2", seq: 10 })), {
      code: "23505",
    });
  });

  test("I4: другий called/submitting у викладача навіть на іншому занятті — 23505", async () => {
    await insert(entry({ student_id: "s-3", seq: 20, status: "submitting" }));
    await assert.rejects(
      insert(
        entry({
          session_id: "00000000-0000-4000-8000-000000000002",
          student_id: "s-4",
          seq: 1,
          status: "called",
        }),
      ),
      { code: "23505" },
    );
  });
});
