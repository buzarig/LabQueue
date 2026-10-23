// Клієнт сценарної сюїти (К7): той самий застосунок, що запускає main.js
// (createApp), лише через HTTP — сюїта не знає, яке під ним сховище.
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/main.js";

export const MISSING = "00000000-0000-4000-8000-000000000000";

export async function createClient() {
  let now = new Date("2026-10-23T09:00:00Z");
  const app = await createApp({ clock: { now: () => now }, logger: false });
  await app.ready();

  /**
   * @param {string} user
   * @param {string} url
   * @param {unknown} [payload]
   * @param {{ key?: string }} [opts]
   */
  const post = (user, url, payload = {}, opts = {}) =>
    app.inject({
      method: "POST",
      url,
      headers: {
        "x-user-id": user,
        "idempotency-key": opts.key ?? randomUUID(),
      },
      payload: /** @type {object} */ (payload),
    });

  /** @param {string} user @param {string} url */
  const get = (user, url) =>
    app.inject({ method: "GET", url, headers: { "x-user-id": user } });

  /**
   * Відповідь з очікуваним статусом (і кодом помилки), інакше — падіння з тілом.
   * @param {import("light-my-request").Response} res
   * @param {number} status
   * @param {string} [code]
   */
  const expectStatus = (res, status, code) => {
    if (
      res.statusCode !== status ||
      (code && res.json().error?.code !== code)
    ) {
      throw new Error(
        `очікували ${status} ${code ?? ""}, отримали ${res.statusCode}: ${res.body}`,
      );
    }
    return res.json();
  };

  /** Заняття t-1 з відкритим записом (S1 + S2). */
  const openSession = async (
    /** @type {Record<string, unknown>} */ over = {},
  ) => {
    const session = expectStatus(
      await post("t-1", "/sessions", {
        subjectId: "nodejs",
        groupId: "kn-21",
        startsAt: "2026-10-23T10:00:00Z",
        room: "301",
        queueLimit: 10,
        labIds: ["nodejs-1", "nodejs-2"],
        ...over,
      }),
      201,
    );
    expectStatus(await post("t-1", `/sessions/${session.id}/open`), 200);
    return session;
  };

  /** @param {string} sessionId @param {string} student @param {string} [labId] */
  const enqueue = async (sessionId, student, labId = "nodejs-1") =>
    expectStatus(
      await post(student, `/sessions/${sessionId}/queue`, { labId }),
      201,
    );

  return {
    app,
    post,
    get,
    expectStatus,
    openSession,
    enqueue,
    /** @param {number} minutes */
    advance(minutes) {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
}
