// catalog: довідники з seed-даних, пакетне читання за id (без N+1 у S1 і S13).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalogModule } from "../../../src/modules/catalog/index.js";
import { createContext } from "../../../src/platform/context.js";
import { createMemoryStore } from "../../../src/platform/memory.js";

function setup() {
  const context = createContext();
  return createCatalogModule({
    storage: { kind: "memory", store: createMemoryStore({ context }) },
  }).api;
}

test("seed: групи, предмети й лаби з data.md", async () => {
  const catalog = setup();
  assert.deepEqual(
    (await catalog.groupsByIds(["kn-21", "kn-22"])).map((g) => g.id),
    ["kn-21", "kn-22"],
  );
  assert.deepEqual(
    (await catalog.subjectsByIds(["nodejs", "db"])).map((s) => s.name),
    ["Node.js", "Бази даних"],
  );
  const labs = await catalog.labsByIds([
    "nodejs-1",
    "nodejs-2",
    "nodejs-3",
    "db-1",
    "db-2",
  ]);
  assert.equal(labs.length, 5);
  assert.deepEqual(
    labs.filter((l) => l.subjectId === "nodejs").map((l) => l.number),
    [1, 2, 3],
  );
});

test("byIds: невідомі id відсутні, дублікати — один раз", async () => {
  const catalog = setup();
  const labs = await catalog.labsByIds(["db-1", "nope", "db-1"]);
  assert.deepEqual(
    labs.map((l) => l.id),
    ["db-1"],
  );
  assert.deepEqual(await catalog.groupsByIds([]), []);
});
