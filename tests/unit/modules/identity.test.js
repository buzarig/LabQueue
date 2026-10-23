// identity: автентифікація за X-User-Id (401), роль (403), користувач у
// контексті й логах (К5, ADR-0030).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityModule } from "../../../src/modules/identity/index.js";
import { createContext } from "../../../src/platform/context.js";
import { createMemoryStore } from "../../../src/platform/memory.js";
import { createServer } from "../../../src/platform/server.js";

async function setup() {
  /** @type {Array<Record<string, unknown>>} */
  const logs = [];
  const context = createContext();
  const store = createMemoryStore({ context });
  const identity = createIdentityModule({ store, context });
  const app = createServer({
    sha: "test",
    context,
    logStream: { write: (line) => void logs.push(JSON.parse(line)) },
  });
  await app.register(identity.plugin);
  app.get("/t/me", async () => {
    app.log.info("хто я");
    return identity.api.currentUser();
  });
  app.get("/t/teacher-only", async () => identity.api.requireRole("teacher"));
  await app.ready();
  return { app, logs };
}

test("без X-User-Id або з невідомим id → 401 UNAUTHENTICATED", async () => {
  const { app } = await setup();
  for (const headers of [{}, { "x-user-id": "nobody" }]) {
    const res = await app.inject({ url: "/t/me", headers });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, "UNAUTHENTICATED");
  }
});

test("відомий користувач потрапляє в контекст, а його id — у логи", async () => {
  const { app, logs } = await setup();
  const res = await app.inject({
    url: "/t/me",
    headers: { "x-user-id": "s-1" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    id: "s-1",
    role: "student",
    groupId: "kn-21",
  });
  const line = logs.find((l) => l.msg === "хто я");
  assert.equal(line?.userId, "s-1");
});

test("дія не для цієї ролі → 403 FORBIDDEN_ROLE", async () => {
  const { app } = await setup();
  const student = await app.inject({
    url: "/t/teacher-only",
    headers: { "x-user-id": "s-1" },
  });
  assert.equal(student.statusCode, 403);
  assert.equal(student.json().error.code, "FORBIDDEN_ROLE");
  const teacher = await app.inject({
    url: "/t/teacher-only",
    headers: { "x-user-id": "t-1" },
  });
  assert.equal(teacher.statusCode, 200);
  assert.equal(teacher.json().groupId, null);
});

test("технічні маршрути не вимагають X-User-Id", async () => {
  const { app } = await setup();
  for (const url of ["/health", "/version"]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url);
  }
});

test("автентифікація раніше за валідацію: POST без X-User-Id і без ключа → 401, не 400", async () => {
  const { app } = await setup();
  const res = await app.inject({ method: "POST", url: "/t/me", payload: {} });
  assert.equal(res.statusCode, 401);
});
