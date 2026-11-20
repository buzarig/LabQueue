// unitOfWork на PostgreSQL (ADR-0030, ADR-0034, ADR-0035): коміт і відкат,
// savepoint для доменних відмов, ідемпотентність, повтори тимчасових
// помилок, 503 і fail-fast на старті.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createContext } from "../../src/platform/context.js";
import {
  connectDb,
  createDbAccess,
  createPgBackend,
  readiness,
} from "../../src/platform/db/index.js";
import { shapedError } from "../../src/platform/errors.js";
import { createUnitOfWork } from "../../src/platform/unit-of-work.js";
import { createTestDb } from "./harness.js";

/** @type {Awaited<ReturnType<typeof createTestDb>>} */
let db;
/** @type {import("postgres").Sql} */
let sql;
const context = createContext();
let now = new Date("2026-10-24T10:00:00Z");
/** @type {Array<{ attempt: number, code: string }>} */
const retries = [];
/** @type {ReturnType<typeof createUnitOfWork>} */
let unitOfWork;
/** @type {ReturnType<typeof createDbAccess>} */
let access;

before(async () => {
  db = await createTestDb();
  sql = await connectDb(db.url);
  await sql`create table public.test_items (id text primary key, v int not null)`;
  access = createDbAccess({ sql, context });
  unitOfWork = createUnitOfWork({
    context,
    clock: { now: () => now },
    backend: createPgBackend({
      sql,
      context,
      onRetry: (info) => retries.push(info),
    }),
  });
});
after(async () => {
  await sql.end();
  await db.drop();
});

/**
 * «Запит» з користувачем і, за потреби, ключем ідемпотентності.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ key?: string, hash?: string }} [opts]
 */
const request = (fn, opts = {}) =>
  context.run(
    {
      processId: "p",
      user: { id: "s-1", role: "student", groupId: "kn-21" },
      ...(opts.key
        ? {
            idempotency: {
              key: opts.key,
              requestHash: opts.hash ?? "h",
              successStatus: 201,
            },
          }
        : {}),
    },
    fn,
  );

/** @param {string} id @param {number} v */
const put = (id, v) =>
  access.write()`insert into public.test_items (id, v) values (${id}, ${v})`;
/** @param {string} id */
const get = async (id) =>
  (await sql`select v from public.test_items where id = ${id}`)[0]?.v;

test("запис поза unitOfWork — помилка; читання — через пул", async () => {
  await assert.rejects(
    request(async () => put("x", 1)),
    /поза unitOfWork/,
  );
  const [row] = await request(() => access.read()`select 1 as one`);
  assert.equal(row.one, 1);
});

test("коміт лишає записи; непередбачена помилка відкочує всю транзакцію", async () => {
  await request(() => unitOfWork(() => put("a", 1)));
  await assert.rejects(
    request(() =>
      unitOfWork(async () => {
        await put("b", 2);
        throw new Error("збій");
      }),
    ),
    /збій/,
  );
  assert.equal(await get("a"), 1);
  assert.equal(await get("b"), undefined);
});

test("ідемпотентність: повтор — збережений результат (jsonb), без нового виклику", async () => {
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          await put(`idem-${calls}`, calls);
          return { id: `idem-${calls}`, at: "2026-10-24T10:00:00.000Z" };
        }),
      { key: "k-ok" },
    );
  assert.deepEqual(await command(), {
    id: "idem-1",
    at: "2026-10-24T10:00:00.000Z",
  });
  assert.deepEqual(await command(), {
    id: "idem-1",
    at: "2026-10-24T10:00:00.000Z",
  });
  assert.equal(calls, 1);
  const [row] = await sql`
    select result_status from platform.idempotency_keys where key = 'k-ok'`;
  assert.equal(row.resultStatus, 201);
});

test("ідемпотентність: доменна відмова відкочує savepoint, ключ комітиться й повторюється", async () => {
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          await put("partial", 1);
          throw shapedError("QUEUE_LIMIT_REACHED", 409, "Ліміт");
        }),
      { key: "k-refused" },
    );
  for (let i = 0; i < 2; i++) {
    await assert.rejects(command(), {
      code: "QUEUE_LIMIT_REACHED",
      statusCode: 409,
    });
  }
  assert.equal(calls, 1);
  assert.equal(await get("partial"), undefined);
});

test("ідемпотентність: той самий ключ з іншим запитом → 409 IDEMPOTENCY_KEY_REUSED", async () => {
  await request(() => unitOfWork(async () => 1), {
    key: "k-reuse",
    hash: "h1",
  });
  await assert.rejects(
    request(() => unitOfWork(async () => 1), { key: "k-reuse", hash: "h2" }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  );
});

test("ідемпотентність: одночасні запити з одним ключем — сервіс виконується один раз", async () => {
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          await access.write()`select pg_sleep(0.1)`;
          return { n: calls };
        }),
      { key: "k-race" },
    );
  const [a, b] = await Promise.all([command(), command()]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b], [{ n: 1 }, { n: 1 }]);
});

test("ідемпотентність: ключ старший за 24 години — виконується знову", async () => {
  let calls = 0;
  const command = () =>
    request(() => unitOfWork(async () => ++calls), { key: "k-old" });
  await command();
  now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(await command(), 2);
});

test("повтори: тимчасова помилка (40001) — ціла транзакція ще раз, до успіху", async () => {
  retries.length = 0;
  let attempts = 0;
  const result = await request(() =>
    unitOfWork(async () => {
      attempts += 1;
      await put(`retry-${attempts}`, attempts);
      if (attempts < 3) {
        throw Object.assign(new Error("serialization"), { code: "40001" });
      }
      return attempts;
    }),
  );
  assert.equal(result, 3);
  assert.deepEqual(
    retries.map((r) => r.attempt),
    [1, 2],
  );
  assert.equal(await get("retry-1"), undefined, "спроби до успіху відкочені");
  assert.equal(await get("retry-3"), 3);
});

test("повтори вичерпано (3) → 503 SOURCE_UNAVAILABLE з Retry-After", async () => {
  retries.length = 0;
  let attempts = 0;
  await assert.rejects(
    request(() =>
      unitOfWork(async () => {
        attempts += 1;
        throw Object.assign(new Error("deadlock"), { code: "40P01" });
      }),
    ),
    { code: "SOURCE_UNAVAILABLE", statusCode: 503, retryAfter: 1 },
  );
  assert.equal(attempts, 4, "1 спроба + 3 повтори");
});

test("справжнє порушення унікальності — 409 CONFLICT без повтору", async () => {
  retries.length = 0;
  await assert.rejects(
    request(() =>
      unitOfWork(async () => {
        await put("dup", 1);
        await put("dup", 2);
      }),
    ),
    { code: "CONFLICT", statusCode: 409 },
  );
  assert.equal(retries.length, 0);
});

test("statement_timeout 3 с → 503 SOURCE_UNAVAILABLE без повтору", async () => {
  retries.length = 0;
  await assert.rejects(
    request(() => unitOfWork(() => access.write()`select pg_sleep(4)`)),
    { code: "SOURCE_UNAVAILABLE" },
  );
  assert.equal(retries.length, 0);
});

test("/ready: справжня БД — true; закритий пул — false", async () => {
  assert.equal(await readiness(sql)(), true);
  const other = await connectDb(db.url);
  await other.end();
  assert.equal(await readiness(other)(), false);
});

test("fail-fast: БД недоступна на старті — помилка одразу, без пароля в тексті", async () => {
  const url = new URL(db.url);
  url.port = "1";
  url.password = "секретний-пароль";
  const started = Date.now();
  await assert.rejects(connectDb(url.href), (error) => {
    assert.match(String(error), /БД недоступна/);
    assert.doesNotMatch(String(error), /секретний-пароль/);
    return true;
  });
  assert.ok(Date.now() - started < 3000, "не довше за таймаут підключення");
});
