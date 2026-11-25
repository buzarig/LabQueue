// Порядок і вибірки на обох сховищах (аудит лаби 3, слабке місце 3). Ранг
// позиції, порядок історії й вибірку для ETA unit-тести перевіряють лише на
// статиці, а repo-pg.js має для них власний SQL. Ця сюїта йде й на
// STORAGE=pg, тож помилка в SQL більше не проходить непоміченою.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createClient } from "./client.js";

/**
 * Повна здача першого в черзі: виклик → прийом → результат за `minutes`.
 * @param {Awaited<ReturnType<typeof createClient>>} c
 * @param {string} sessionId
 * @param {number} minutes
 * @param {{ outcome: "passed" | "rework", score?: number }} [result]
 */
async function serveNext(
  c,
  sessionId,
  minutes,
  result = { outcome: "passed", score: 80 },
) {
  const called = c.expectStatus(
    await c.post("t-1", `/sessions/${sessionId}/queue/call-next`),
    200,
  );
  c.expectStatus(await c.post("t-1", `/entries/${called.id}/start`), 200);
  c.advance(minutes);
  return c.expectStatus(
    await c.post("t-1", `/entries/${called.id}/result`, result),
    200,
  );
}

describe("порядок і вибірки: ранг, історія, ETA", () => {
  test("S11: позиція — ранг лише серед waiting; викликаний і той, хто здає, не рахуються", async () => {
    const c = await createClient();
    const { id } = await c.openSession();
    for (const s of ["s-1", "s-2", "s-3"]) await c.enqueue(id, s);
    const called = c.expectStatus(
      await c.post("t-1", `/sessions/${id}/queue/call-next`),
      200,
    );
    const position = async (/** @type {string} */ s) =>
      c.expectStatus(await c.get(s, `/sessions/${id}/queue/me`), 200).position;
    assert.deepEqual([await position("s-2"), await position("s-3")], [1, 2]);
    c.expectStatus(await c.post("t-1", `/entries/${called.id}/start`), 200);
    assert.deepEqual([await position("s-2"), await position("s-3")], [1, 2]);
  });

  test("S13: історія — від нової здачі до старої", async () => {
    const c = await createClient();
    const { id } = await c.openSession();
    await c.enqueue(id, "s-1", "nodejs-1");
    await serveNext(c, id, 5, { outcome: "passed", score: 70 });
    await c.enqueue(id, "s-1", "nodejs-2");
    await serveNext(c, id, 5, { outcome: "rework" });
    const history = c.expectStatus(await c.get("s-1", "/me/history"), 200);
    assert.deepEqual(
      history.map((/** @type {any} */ h) => [h.labId, h.status]),
      [
        ["nodejs-2", "rework"],
        ["nodejs-1", "passed"],
      ],
    );
  });

  test("S11: ETA — лише п'ять останніх здач", async () => {
    const c = await createClient();
    const { id } = await c.openSession();
    for (const s of ["s-1", "s-2", "s-3", "s-4"]) await c.enqueue(id, s);
    // Найстаріша здача — 60 хв, далі п'ять по 10 хв: середнє вибірки — 10 хв.
    await serveNext(c, id, 60);
    for (const s of ["s-1", "s-2", "s-3", "s-4"]) {
      await c.enqueue(id, s, "nodejs-2");
      await serveNext(c, id, 10);
    }
    await serveNext(c, id, 10);
    // Шість здач позаду, черга: s-3, s-4.
    assert.deepEqual(
      c.expectStatus(await c.get("s-4", `/sessions/${id}/queue/me`), 200),
      { status: "waiting", position: 2, etaMinutes: 20 },
      "2 × 10 хв; усі шість здач дали б 37, п'ять найстаріших — 40",
    );
  });
});
