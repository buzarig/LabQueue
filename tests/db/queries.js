// Вимірювання SQL-запитів сценаріїв S1–S13 при малому й великому N (К16):
// кількість має бути однаковою — тоді немає запитів у циклі (N+1). Спільне
// для тесту tests/db/queries.test.js і звіту reports/lab2/queries.txt.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../../src/main.js";
import { createTestDb } from "./harness.js";

export const SMALL = 1;
export const LARGE = 10;
const STUDENTS = Array.from({ length: LARGE + 2 }, (_, i) => `s-q${i + 1}`);

/** Не доменні: транзакції, ідемпотентність і службові запити драйвера до pg_catalog. */
const SERVICE =
  /^\s*(begin|commit|rollback|savepoint|release)\b|platform\.idempotency_keys|pg_catalog\./i;

/**
 * Очікувані кількості з data.md, «Запити сценаріїв».
 * @returns {Map<string, number>}
 */
export function expectedFromDataMd() {
  const text = readFileSync(
    resolve(import.meta.dirname, "../../docs/specs/lab2-db-scenarios/data.md"),
    "utf8",
  );
  const section =
    text.split(/^## Запити сценаріїв$/m)[1]?.split(/^## /m)[0] ?? "";
  /** @type {Map<string, number>} */
  const expected = new Map();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const count = Number(cells[3]);
    if (!/^S\d/.test(cells[1] ?? "") || !Number.isInteger(count)) continue;
    for (const s of cells[1].split(",")) expected.set(s.trim(), count);
  }
  return expected;
}

/**
 * Застосунок на окремій БД із лічильником запитів.
 * @returns {Promise<{ measure: (fn: () => Promise<any>) => Promise<{ all: number, domain: number, status: number }>, api: Api, close: () => Promise<void> }>}
 */
async function setup() {
  const db = await createTestDb();
  const side = db.connect();
  for (const id of STUDENTS) {
    await side`
      insert into identity.users (id, name, role, group_id)
      values (${id}, ${id}, 'student', 'kn-21')`;
  }
  await side.end();
  /** @type {string[] | null} */
  let log = null;
  const app = await createApp({
    storage: "pg",
    databaseUrl: db.url,
    logger: false,
    onQuery: (query) => log?.push(query),
  });
  const api = makeApi(app);
  return {
    api,
    async measure(fn) {
      log = [];
      const res = await fn();
      const queries = log;
      log = null;
      return {
        all: queries.length,
        domain: queries.filter((q) => !SERVICE.test(q)).length,
        status: res.statusCode,
      };
    },
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

/** @param {Awaited<ReturnType<typeof createApp>>} app */
function makeApi(app) {
  /** @param {string} user @param {string} url @param {unknown} [payload] */
  const post = (user, url, payload = {}) =>
    app.inject({
      method: "POST",
      url,
      headers: { "x-user-id": user, "idempotency-key": randomUUID() },
      payload: /** @type {object} */ (payload),
    });
  /** @param {string} user @param {string} url */
  const get = (user, url) =>
    app.inject({ url, headers: { "x-user-id": user } });
  /** Заняття t-1; open — з відкритим записом. */
  const session = async (
    /** @type {Record<string, unknown>} */ over = {},
    open = true,
  ) => {
    const { id } = (
      await post("t-1", "/sessions", {
        subjectId: "nodejs",
        groupId: "kn-21",
        startsAt: "2026-10-24T10:00:00Z",
        room: "301",
        queueLimit: 50,
        labIds: ["nodejs-1"],
        ...over,
      })
    ).json();
    if (open) await post("t-1", `/sessions/${id}/open`);
    return /** @type {string} */ (id);
  };
  /** @param {string} id @param {number} n перші n студентів у черзі */
  const fill = async (id, n, from = 0) => {
    for (const s of STUDENTS.slice(from, from + n)) {
      await post(s, `/sessions/${id}/queue`, { labId: "nodejs-1" });
    }
  };
  /** Виклик → прийом → результат першого в черзі; повертає запис. */
  const serve = async (/** @type {string} */ id) => {
    const entry = (await post("t-1", `/sessions/${id}/queue/call-next`)).json();
    await post("t-1", `/entries/${entry.id}/start`);
    await post("t-1", `/entries/${entry.id}/result`, {
      outcome: "passed",
      score: 90,
    });
    return entry;
  };
  return { post, get, session, fill, serve };
}

/** @typedef {ReturnType<typeof makeApi>} Api */

/**
 * Для кожного сценарію: підготовка з N і сам запит, що вимірюється.
 * @type {Record<string, (api: Api, n: number) => Promise<() => Promise<any>>>}
 */
const SCENARIOS = {
  async S1(api, n) {
    const labIds = ["nodejs-1", "nodejs-2", "nodejs-3"].slice(
      0,
      Math.min(n, 3),
    );
    return () =>
      api.post("t-1", "/sessions", {
        subjectId: "nodejs",
        groupId: "kn-21",
        startsAt: "2026-10-24T10:00:00Z",
        room: "1",
        queueLimit: 5,
        labIds,
      });
  },
  async S2(api, n) {
    const id = await api.session();
    await api.fill(id, n);
    await api.post("t-1", `/sessions/${id}/close`);
    return () => api.post("t-1", `/sessions/${id}/open`);
  },
  async S3(api, n) {
    const id = await api.session();
    await api.fill(id, n);
    return () => api.post("t-1", `/sessions/${id}/close`);
  },
  async S4(api, n) {
    const id = await api.session();
    await api.fill(id, n);
    await api.post("t-1", `/sessions/${id}/close`);
    return () => api.post("t-1", `/sessions/${id}/finish`);
  },
  async S5(api, n) {
    const id = await api.session();
    await api.fill(id, n);
    return () => api.post("t-1", `/sessions/${id}/queue/call-next`);
  },
  async S6(api, n) {
    const id = await api.session();
    await api.fill(id, n + 1);
    const entry = (
      await api.post("t-1", `/sessions/${id}/queue/call-next`)
    ).json();
    return () => api.post("t-1", `/entries/${entry.id}/start`);
  },
  async S7(api, n) {
    const id = await api.session();
    await api.fill(id, n + 1);
    const entry = (
      await api.post("t-1", `/sessions/${id}/queue/call-next`)
    ).json();
    await api.post("t-1", `/entries/${entry.id}/start`);
    return () =>
      api.post("t-1", `/entries/${entry.id}/result`, {
        outcome: "passed",
        score: 80,
      });
  },
  async S8(api, n) {
    const id = await api.session();
    await api.fill(id, n + 1);
    const entry = (
      await api.post("t-1", `/sessions/${id}/queue/call-next`)
    ).json();
    return () => api.post("t-1", `/entries/${entry.id}/no-show`);
  },
  async S9(api, n) {
    for (let i = 0; i < n; i++) {
      const id = await api.session({
        startsAt: `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      });
      await api.fill(id, 1);
    }
    return () => api.get("s-q1", "/sessions");
  },
  async S10(api, n) {
    const id = await api.session();
    await api.fill(id, n);
    const next = STUDENTS[n];
    return () => api.post(next, `/sessions/${id}/queue`, { labId: "nodejs-1" });
  },
  async S11(api, n) {
    const id = await api.session();
    await api.fill(id, n + 1);
    for (let i = 0; i < Math.min(n, 5); i++) await api.serve(id);
    const last = STUDENTS[n];
    return () => api.get(last, `/sessions/${id}/queue/me`);
  },
  async S12(api, n) {
    const id = await api.session();
    await api.fill(id, n + 1);
    const entry = (
      await api.post(STUDENTS[n + 1], `/sessions/${id}/queue`, {
        labId: "nodejs-1",
      })
    ).json();
    return () => api.post(STUDENTS[n + 1], `/entries/${entry.id}/leave`);
  },
  async S13(api, n) {
    for (let i = 0; i < n; i++) {
      const id = await api.session({
        startsAt: `2026-12-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      });
      await api.post("s-q1", `/sessions/${id}/queue`, { labId: "nodejs-1" });
      await api.serve(id);
    }
    return () => api.get("s-q1", "/me/history");
  },
};

/**
 * Кількість запитів кожного сценарію при N = SMALL і N = LARGE, кожне
 * вимірювання — на власній БД.
 * @returns {Promise<Array<{ scenario: string, small: { all: number, domain: number, status: number }, large: { all: number, domain: number, status: number } }>>}
 */
export async function measureAll() {
  const rows = [];
  for (const [scenario, prepare] of Object.entries(SCENARIOS)) {
    /** @type {Record<string, { all: number, domain: number, status: number }>} */
    const result = {};
    for (const [label, n] of [
      ["small", SMALL],
      ["large", LARGE],
    ]) {
      const env = await setup();
      try {
        const request = await prepare(env.api, /** @type {number} */ (n));
        result[label] = await env.measure(request);
      } finally {
        await env.close();
      }
    }
    rows.push({ scenario, small: result.small, large: result.large });
  }
  return rows;
}
