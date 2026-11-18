// Активні статуси (аудит лаби 3, слабке місце 1): «активний запис» — waiting,
// called або submitting (I1). Ліміт черги (I2), «викладач зайнятий» (I4) і
// стан черг (S9) мають рахувати всі три. Решта сюїти перевіряла їх лише на
// waiting і called — підміна набору статусів на коротший проходила непоміченою.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createClient } from "./client.js";

describe("активні статуси: викликаний і той, хто здає, — так само активні", () => {
  test("I2: викликаний і той, хто здає, займають місця в ліміті черги", async () => {
    const c = await createClient();
    const { id } = await c.openSession({ queueLimit: 2 });
    await c.enqueue(id, "s-1");
    await c.enqueue(id, "s-2");
    const called = c.expectStatus(
      await c.post("t-1", `/sessions/${id}/queue/call-next`),
      200,
    );
    const join = () =>
      c.post("s-3", `/sessions/${id}/queue`, { labId: "nodejs-1" });
    c.expectStatus(await join(), 409, "QUEUE_LIMIT_REACHED");
    c.expectStatus(await c.post("t-1", `/entries/${called.id}/start`), 200);
    c.expectStatus(await join(), 409, "QUEUE_LIMIT_REACHED");
  });

  test("I4, S9: поки студент здає, викладач зайнятий, а стан черг показує, хто в нього", async () => {
    const c = await createClient();
    const { id } = await c.openSession();
    await c.enqueue(id, "s-1");
    await c.enqueue(id, "s-2");
    const called = c.expectStatus(
      await c.post("t-1", `/sessions/${id}/queue/call-next`),
      200,
    );
    c.expectStatus(await c.post("t-1", `/entries/${called.id}/start`), 200);
    c.expectStatus(
      await c.post("t-1", `/sessions/${id}/queue/call-next`),
      409,
      "TEACHER_BUSY",
    );
    const [session] = c.expectStatus(await c.get("s-2", "/sessions"), 200);
    assert.equal(session.calledStudentId, "s-1");
    assert.equal(session.waitingCount, 1);
  });
});
