// Транзакції статики (ADR-0027, ADR-0030, промпт 039) й ідемпотентність
// (ADR-0035) на сховищі в пам'яті.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "../../../src/platform/context.js";
import { shapedError } from "../../../src/platform/errors.js";
import { createMemoryStore } from "../../../src/platform/memory.js";
import { createUnitOfWork } from "../../../src/platform/unit-of-work.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function setup() {
  const context = createContext();
  let now = new Date("2026-10-23T10:00:00Z");
  const clock = { now: () => now };
  const store = createMemoryStore({ context });
  const unitOfWork = createUnitOfWork({ context, clock, backend: store });
  /** @type {ReturnType<typeof store.table<{ v: number }>>} */
  const items = store.table("test.items");
  /**
   * Запуск «запиту»: власний контекст, як у сервері.
   * @template T
   * @param {() => Promise<T>} fn
   * @param {{ user?: string, key?: string, hash?: string }} [opts]
   */
  const request = (fn, opts = {}) =>
    context.run(
      {
        processId: "p",
        ...(opts.user
          ? { user: { id: opts.user, role: "teacher", groupId: null } }
          : {}),
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
  const advance = (/** @type {number} */ ms) => {
    now = new Date(now.getTime() + ms);
  };
  return { store, unitOfWork, items, request, advance };
}

/** @param {number} ms */
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("запис поза unitOfWork — помилка", async () => {
  const { items, request } = setup();
  await assert.rejects(
    request(async () => items.put("a", { v: 1 })),
    /поза unitOfWork/,
  );
});

test("коміт лишає записи; непередбачена помилка відкочує всі записи транзакції", async () => {
  const { items, request, unitOfWork } = setup();
  await request(() =>
    unitOfWork(async () => {
      items.put("a", { v: 1 });
    }),
  );
  await assert.rejects(
    request(() =>
      unitOfWork(async () => {
        items.put("a", { v: 2 });
        items.put("b", { v: 3 });
        items.remove("a");
        throw new Error("збій");
      }),
    ),
    /збій/,
  );
  assert.deepEqual(items.get("a"), { v: 1 });
  assert.equal(items.get("b"), undefined);
});

test("рядки копіюються: зміна прочитаного об'єкта не змінює таблицю", async () => {
  const { items, request, unitOfWork } = setup();
  await request(() => unitOfWork(async () => items.put("a", { v: 1 })));
  const row = /** @type {{ v: number }} */ (items.get("a"));
  row.v = 99;
  assert.deepEqual(items.get("a"), { v: 1 });
});

test("відкат транзакції викладача A не затирає паралельний коміт викладача B", async () => {
  const { store, items, request, unitOfWork } = setup();
  const a = request(() =>
    unitOfWork(async () => {
      await store.lockTeacher("t-1");
      items.put("a", { v: 1 });
      await tick(20);
      throw new Error("A падає");
    }),
  );
  const b = request(() =>
    unitOfWork(async () => {
      await store.lockTeacher("t-2");
      await tick(5);
      items.put("b", { v: 2 });
    }),
  );
  await assert.rejects(a, /A падає/);
  await b;
  assert.equal(items.get("a"), undefined);
  assert.deepEqual(items.get("b"), { v: 2 });
});

test("транзакції одного викладача серіалізуються, різних — ідуть паралельно", async () => {
  const { store, request, unitOfWork } = setup();
  /** @type {string[]} */
  const events = [];
  const job = (/** @type {string} */ name, /** @type {string} */ teacher) =>
    request(() =>
      unitOfWork(async () => {
        await store.lockTeacher(teacher);
        events.push(`${name}:start`);
        await tick(10);
        events.push(`${name}:end`);
      }),
    );
  await Promise.all([job("x", "t-1"), job("y", "t-1"), job("z", "t-2")]);
  const order = events.join(" ");
  assert.match(order, /x:start.*x:end.*y:start.*y:end/);
  assert.ok(
    events.indexOf("z:start") < events.indexOf("x:end"),
    "t-2 мав іти паралельно з t-1",
  );
});

test("вкладений unitOfWork — помилка", async () => {
  const { request, unitOfWork } = setup();
  await assert.rejects(
    request(() => unitOfWork(() => unitOfWork(async () => 1))),
    /вкладений/,
  );
});

test("ідемпотентність: повтор повертає збережений результат без нового виклику", async () => {
  const { items, request, unitOfWork } = setup();
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          items.put(`row-${calls}`, { v: calls });
          return { id: `row-${calls}` };
        }),
      { user: "t-1", key: "k-1" },
    );
  assert.deepEqual(await command(), { id: "row-1" });
  assert.deepEqual(await command(), { id: "row-1" });
  assert.equal(calls, 1);
  assert.equal(items.get("row-2"), undefined);
});

test("ідемпотентність: доменна відмова відкочує зміни, але комітиться з ключем і повторюється", async () => {
  const { items, request, unitOfWork } = setup();
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          items.put("partial", { v: 1 });
          throw shapedError("QUEUE_LIMIT_REACHED", 409, "Ліміт");
        }),
      { user: "s-1", key: "k-1" },
    );
  for (const attempt of [1, 2]) {
    await assert.rejects(
      command(),
      (error) => {
        assert.equal(/** @type {any} */ (error).code, "QUEUE_LIMIT_REACHED");
        assert.equal(/** @type {any} */ (error).statusCode, 409);
        return true;
      },
      `спроба ${attempt}`,
    );
  }
  assert.equal(calls, 1);
  assert.equal(items.get("partial"), undefined);
});

test("ідемпотентність: той самий ключ з іншим запитом → 409 IDEMPOTENCY_KEY_REUSED", async () => {
  const { request, unitOfWork } = setup();
  await request(() => unitOfWork(async () => ({ ok: true })), {
    user: "s-1",
    key: "k-1",
    hash: "h1",
  });
  await assert.rejects(
    request(() => unitOfWork(async () => ({ ok: true })), {
      user: "s-1",
      key: "k-1",
      hash: "h2",
    }),
    (error) => /** @type {any} */ (error).code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("ідемпотентність: ключі різних користувачів не перетинаються", async () => {
  const { request, unitOfWork } = setup();
  let calls = 0;
  const run = (/** @type {string} */ user) =>
    request(() => unitOfWork(async () => ++calls), { user, key: "same" });
  assert.equal(await run("s-1"), 1);
  assert.equal(await run("s-2"), 2);
});

test("ідемпотентність: непередбачена помилка не зберігає ключ, повтор виконується знову", async () => {
  const { request, unitOfWork } = setup();
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          if (calls === 1) throw new Error("обрив");
          return { ok: calls };
        }),
      { user: "s-1", key: "k-1" },
    );
  await assert.rejects(command(), /обрив/);
  assert.deepEqual(await command(), { ok: 2 });
});

test("ідемпотентність: ключ старший за 24 години вважається відсутнім", async () => {
  const { request, unitOfWork, advance } = setup();
  let calls = 0;
  const command = () =>
    request(() => unitOfWork(async () => ++calls), {
      user: "s-1",
      key: "k-1",
    });
  await command();
  advance(DAY_MS - 1);
  assert.equal(await command(), 1);
  advance(1);
  assert.equal(await command(), 2);
});

test("ідемпотентність: одночасні запити з одним ключем — сервіс виконується один раз", async () => {
  const { request, unitOfWork } = setup();
  let calls = 0;
  const command = () =>
    request(
      () =>
        unitOfWork(async () => {
          calls += 1;
          await tick(10);
          return { n: calls };
        }),
      { user: "s-1", key: "k-1" },
    );
  const [first, second] = await Promise.all([command(), command()]);
  assert.equal(calls, 1);
  assert.deepEqual(first, { n: 1 });
  assert.deepEqual(second, { n: 1 });
});
