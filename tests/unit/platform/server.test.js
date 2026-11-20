// Платформа: processId і X-Request-Id, processId і користувач у логах з
// будь-якого рівня (К5, ADR-0030), один глобальний обробник помилок (К6, ADR-0031).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "../../../src/platform/context.js";
import { shapedError } from "../../../src/platform/errors.js";
import { createServer } from "../../../src/platform/server.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Сервер з логами в масив і тестовими маршрутами. */
async function setup() {
  /** @type {Array<Record<string, unknown>>} */
  const logs = [];
  const context = createContext();
  const app = createServer({
    sha: "test",
    context,
    logStream: { write: (line) => void logs.push(JSON.parse(line)) },
  });

  // «Глибокий рівень»: функція без request і без параметрів контексту, як
  // сервіс чи репозиторій. Логує через спільний логер застосунку.
  const deepLog = () => app.log.info("з глибини");

  app.get("/t/log", async () => {
    context.current().user = { id: "s-1", role: "student", groupId: "kn-21" };
    deepLog();
    return { ok: true };
  });
  app.get("/t/domain", async () => {
    throw shapedError("QUEUE_LIMIT_REACHED", 409, "Ліміт черги вичерпано");
  });
  app.get("/t/crash", async () => {
    throw new Error("секретна деталь");
  });
  app.get("/t/db-down", async () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
  });
  app.get("/t/unique", async () => {
    throw Object.assign(new Error("duplicate key"), { code: "23505" });
  });
  app.post(
    "/t/schema",
    {
      schema: {
        body: {
          type: "object",
          properties: { n: { type: "integer" } },
          required: ["n"],
          additionalProperties: false,
        },
      },
    },
    async () => ({ ok: true }),
  );
  /** @type {unknown[]} */
  const seen = [];
  app.post("/t/created", { config: { successStatus: 201 } }, async () => {
    seen.push(context.current().idempotency);
    return {};
  });
  await app.ready();
  return { app, logs, context, seen };
}

test("processId: X-Request-Id від клієнта повертається у відповіді", async () => {
  const { app } = await setup();
  const res = await app.inject({
    url: "/health",
    headers: { "x-request-id": "abc-123" },
  });
  assert.equal(res.headers["x-request-id"], "abc-123");
});

test("processId: без заголовка або з небезпечним значенням — новий UUID", async () => {
  const { app } = await setup();
  const none = await app.inject({ url: "/health" });
  assert.match(String(none.headers["x-request-id"]), UUID);
  const bad = await app.inject({
    url: "/health",
    headers: { "x-request-id": "a b\nc" },
  });
  assert.match(String(bad.headers["x-request-id"]), UUID);
});

test("логи: processId і користувач потрапляють у лог з глибокого рівня без параметрів", async () => {
  const { app, logs } = await setup();
  await app.inject({ url: "/t/log", headers: { "x-request-id": "p-1" } });
  const deep = logs.find((line) => line.msg === "з глибини");
  assert.ok(deep, "лог із глибокого рівня не знайдено");
  assert.equal(deep.processId, "p-1");
  assert.equal(deep.userId, "s-1");
});

test("логи: два паралельні запити не змішують processId", async () => {
  const { app, logs } = await setup();
  await Promise.all([
    app.inject({ url: "/t/log", headers: { "x-request-id": "a" } }),
    app.inject({ url: "/t/log", headers: { "x-request-id": "b" } }),
  ]);
  const deep = logs.filter((line) => line.msg === "з глибини");
  assert.deepEqual(deep.map((line) => line.processId).sort(), ["a", "b"]);
});

test("помилки: доменна помилка → її статус і { error: { code, message } }", async () => {
  const { app } = await setup();
  const res = await app.inject({ url: "/t/domain" });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), {
    error: { code: "QUEUE_LIMIT_REACHED", message: "Ліміт черги вичерпано" },
  });
});

test("помилки: тіло не за схемою чи битий JSON → 400 VALIDATION_FAILED", async () => {
  const { app } = await setup();
  const extra = await app.inject({
    method: "POST",
    url: "/t/schema",
    headers: { "idempotency-key": "k-1" },
    payload: { n: 1, extra: true },
  });
  assert.equal(extra.statusCode, 400);
  assert.equal(extra.json().error.code, "VALIDATION_FAILED");
  const broken = await app.inject({
    method: "POST",
    url: "/t/schema",
    headers: { "content-type": "application/json", "idempotency-key": "k-2" },
    payload: "{",
  });
  assert.equal(broken.statusCode, 400);
  assert.equal(broken.json().error.code, "VALIDATION_FAILED");
});

test("помилки: непередбачена → 500 INTERNAL без деталей, деталі в лог з processId", async () => {
  const { app, logs } = await setup();
  const res = await app.inject({
    url: "/t/crash",
    headers: { "x-request-id": "p-crash" },
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error.code, "INTERNAL");
  assert.doesNotMatch(res.body, /секретна деталь/);
  const logged = logs.find((line) => line.msg === "непередбачена помилка");
  assert.ok(logged, "непередбачена помилка не залогована");
  assert.equal(logged.processId, "p-crash");
});

test("помилки: невідомий маршрут → 404 ROUTE_NOT_FOUND у тому самому форматі", async () => {
  const { app } = await setup();
  const res = await app.inject({ url: "/nope" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "ROUTE_NOT_FOUND");
});

test("ідемпотентність: POST без Idempotency-Key або з задовгим ключем → 400", async () => {
  const { app } = await setup();
  const none = await app.inject({
    method: "POST",
    url: "/t/schema",
    payload: { n: 1 },
  });
  assert.equal(none.statusCode, 400);
  assert.match(none.json().error.message, /Idempotency-Key/);
  const long = await app.inject({
    method: "POST",
    url: "/t/schema",
    headers: { "idempotency-key": "x".repeat(101) },
    payload: { n: 1 },
  });
  assert.equal(long.statusCode, 400);
  const ok = await app.inject({
    method: "POST",
    url: "/t/schema",
    headers: { "idempotency-key": "x".repeat(100) },
    payload: { n: 1 },
  });
  assert.equal(ok.statusCode, 200);
});

test("ідемпотентність: ключ, хеш і статус успіху маршруту лягають у контекст", async () => {
  const { app, seen } = await setup();
  const send = (/** @type {object} */ payload) =>
    app.inject({
      method: "POST",
      url: "/t/created",
      headers: { "idempotency-key": "k" },
      payload,
    });
  await send({ a: 1 });
  await send({ a: 2 });
  const [first, second] =
    /** @type {Array<{ key: string, requestHash: string, successStatus: number }>} */ (
      seen
    );
  assert.equal(first.key, "k");
  assert.equal(first.successStatus, 201);
  assert.notEqual(first.requestHash, second.requestHash);
});

test("збої БД: недоступна → 503 SOURCE_UNAVAILABLE з Retry-After (ADR-0034)", async () => {
  const { app } = await setup();
  const res = await app.inject({ url: "/t/db-down" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, "SOURCE_UNAVAILABLE");
  assert.equal(res.headers["retry-after"], "1");
});

test("збої БД: друга лінія 23505 → 409 CONFLICT і помилка в лог", async () => {
  const { app, logs } = await setup();
  const res = await app.inject({ url: "/t/unique" });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, "CONFLICT");
  assert.ok(
    logs.some((l) => l.msg === "спрацювала друга лінія БД" && l.level === 50),
  );
});

test("/ready: 200 ready, а без джерела — 503 unavailable; X-User-Id не потрібен", async () => {
  const { app } = await setup();
  assert.deepEqual((await app.inject({ url: "/ready" })).json(), {
    status: "ready",
  });
  const down = createServer({
    sha: "t",
    context: createContext(),
    logger: false,
    ready: async () => false,
  });
  const res = await down.inject({ url: "/ready" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { status: "unavailable" });
});

test("контекст: current() поза запитом — помилка, а не тиха робота без контексту", () => {
  const context = createContext();
  assert.throws(() => context.current(), /поза запитом/);
});
