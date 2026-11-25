// E2E (spec лаби 3, критерії 9–10): зібраний dist/main.js окремим процесом на
// справжній PostgreSQL, повний сценарій S1–S13 справжніми HTTP-запитами.
// Кожен прогін — нова БД із шаблону (міграції й seed, ADR-0033), яка після
// прогону видаляється: повторний запуск не залежить від попереднього.
// Час — справжній (clock застосунку не підмінюється), тому ETA після здачі
// перевіряється межею, а не точним числом.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, describe, test } from "node:test";
import { createTestDb } from "../db/harness.js";

const ENTRY = "dist/main.js";

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("E2E: dist/ + PostgreSQL, заняття від створення до історії (S1–S13)", () => {
  /** @type {Awaited<ReturnType<typeof createTestDb>>} */
  let db;
  /** @type {import("node:child_process").ChildProcess} */
  let child;
  /** @type {string} */
  let base;
  /** @type {string} */
  let sessionId;
  /** @type {Record<string, string>} */
  const entries = {};

  before(async () => {
    assert.ok(existsSync(ENTRY), `${ENTRY} не знайдено — спершу make build`);
    db = await createTestDb();
    const port = await freePort();
    child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        STORAGE: "pg",
        DATABASE_URL: db.url,
      },
      stdio: "ignore",
    });
    base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${base}/ready`)).status === 200) return;
      } catch {
        // процес ще не слухає порт
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${ENTRY} не став ready за 10 с`);
  });

  after(async () => {
    if (child) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    if (db) await db.drop();
  });

  /**
   * HTTP-запит від імені користувача; статус і код помилки мають збігтися.
   * @param {"GET" | "POST"} method
   * @param {string} user
   * @param {string} path
   * @param {number} status
   * @param {{ body?: object, code?: string }} [opts]
   */
  async function call(method, user, path, status, opts = {}) {
    /** @type {Record<string, string>} */
    const headers = { "x-user-id": user };
    if (method === "POST") {
      headers["idempotency-key"] = randomUUID();
      headers["content-type"] = "application/json";
    }
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    });
    const json = await response.json();
    assert.equal(
      response.status,
      status,
      `${method} ${path}: ${JSON.stringify(json)}`,
    );
    if (opts.code) assert.equal(json.error?.code, opts.code);
    return json;
  }

  test("технічні маршрути: /health 200, /ready 200 на справжній БД", async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/ready`)).json(), {
      status: "ready",
    });
  });

  test("S1, S2: викладач створює заняття й відкриває запис", async () => {
    const session = await call("POST", "t-1", "/sessions", 201, {
      body: {
        subjectId: "nodejs",
        groupId: "kn-21",
        startsAt: "2026-11-20T10:00:00Z",
        room: "301",
        queueLimit: 3,
        labIds: ["nodejs-1", "nodejs-2"],
      },
    });
    assert.equal(session.state, "planned");
    sessionId = session.id;
    const opened = await call(
      "POST",
      "t-1",
      `/sessions/${sessionId}/open`,
      200,
    );
    assert.equal(opened.state, "open");
  });

  test("S10: троє стають у чергу, четвертий — понад ліміт", async () => {
    for (const student of ["s-1", "s-2", "s-3"]) {
      const entry = await call(
        "POST",
        student,
        `/sessions/${sessionId}/queue`,
        201,
        { body: { labId: "nodejs-1" } },
      );
      entries[student] = entry.id;
    }
    await call("POST", "s-4", `/sessions/${sessionId}/queue`, 409, {
      body: { labId: "nodejs-1" },
      code: "QUEUE_LIMIT_REACHED",
    });
  });

  test("S9, S11: стан черг і позиція з ETA без здач", async () => {
    const [session] = await call("GET", "s-4", "/sessions", 200);
    assert.equal(session.id, sessionId);
    assert.equal(session.waitingCount, 3);
    assert.deepEqual(
      await call("GET", "s-3", `/sessions/${sessionId}/queue/me`, 200),
      { status: "waiting", position: 3, etaMinutes: 30 },
    );
  });

  test("S12: вихід із черги зсуває позиції", async () => {
    const left = await call(
      "POST",
      "s-2",
      `/entries/${entries["s-2"]}/leave`,
      200,
    );
    assert.equal(left.status, "left");
    const me = await call("GET", "s-3", `/sessions/${sessionId}/queue/me`, 200);
    assert.equal(me.position, 2);
  });

  test("S5, S8: виклик і перша неявка — студент у кінець черги", async () => {
    const called = await call(
      "POST",
      "t-1",
      `/sessions/${sessionId}/queue/call-next`,
      200,
    );
    assert.equal(called.studentId, "s-1");
    const noShow = await call(
      "POST",
      "t-1",
      `/entries/${entries["s-1"]}/no-show`,
      200,
    );
    assert.equal(noShow.status, "waiting");
    assert.equal(noShow.noShowCount, 1);
  });

  test("S5–S7: виклик, прийом, результат з балом; повторний старт — конфлікт", async () => {
    const called = await call(
      "POST",
      "t-1",
      `/sessions/${sessionId}/queue/call-next`,
      200,
    );
    assert.equal(called.studentId, "s-3");
    await call("POST", "t-1", `/entries/${called.id}/start`, 200);
    await call("POST", "t-1", `/entries/${called.id}/start`, 409, {
      code: "ENTRY_STATE_CONFLICT",
    });
    const passed = await call(
      "POST",
      "t-1",
      `/entries/${called.id}/result`,
      200,
      { body: { outcome: "passed", score: 92 } },
    );
    assert.equal(passed.status, "passed");
    const me = await call("GET", "s-1", `/sessions/${sessionId}/queue/me`, 200);
    assert.equal(me.position, 1);
    assert.ok(
      me.etaMinutes <= 1,
      `здача тривала мілісекунди, ETA ≤ 1 хв, отримали ${me.etaMinutes}`,
    );
  });

  test("S3, S4: закриття запису, виклик, завершення — викликаний стає missed", async () => {
    await call("POST", "t-1", `/sessions/${sessionId}/close`, 200);
    await call("POST", "s-4", `/sessions/${sessionId}/queue`, 409, {
      body: { labId: "nodejs-1" },
      code: "ENROLLMENT_CLOSED",
    });
    const called = await call(
      "POST",
      "t-1",
      `/sessions/${sessionId}/queue/call-next`,
      200,
    );
    assert.equal(called.studentId, "s-1");
    const finished = await call(
      "POST",
      "t-1",
      `/sessions/${sessionId}/finish`,
      200,
    );
    assert.equal(finished.state, "finished");
    assert.equal(finished.missedCount, 1);
  });

  test("S13: історія здач — з БД, після всього сценарію", async () => {
    const history = await call("GET", "s-3", "/me/history", 200);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "passed");
    assert.equal(history[0].score, 92);
    assert.deepEqual(await call("GET", "s-1", "/me/history", 200), []);
  });
});
