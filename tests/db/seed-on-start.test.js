// Seed окремим кроком на старті (spec лаби 4, критерій 11): без прапорця —
// нічого, з SEED_ON_START=1 — довідники й користувачі, повтор без дублів.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { migrate } from "../../scripts/migrate.js";
import { createTestDb } from "./harness.js";

/** @type {Awaited<ReturnType<typeof createTestDb>>} */
let db;
/** @type {import("postgres").Sql} */
let sql;

before(async () => {
  db = await createTestDb({ empty: true });
  sql = db.connect();
  await migrate(sql);
});

after(async () => {
  await sql?.end();
  await db?.drop();
});

/** @param {Record<string, string>} env */
function run(env) {
  /** @type {Record<string, string | undefined>} */
  const base = { ...process.env, DATABASE_URL: db.url };
  delete base.SEED_ON_START;
  return execFileSync(process.execPath, ["scripts/seed-on-start.js"], {
    env: { ...base, ...env },
    encoding: "utf8",
  });
}

const counts = async () =>
  (
    await sql`
      select (select count(*)::int from identity.users) as users,
        (select count(*)::int from catalog.groups) as groups,
        (select count(*)::int from catalog.subjects) as subjects,
        (select count(*)::int from catalog.labs) as labs`
  )[0];

test("без прапорця (і з SEED_ON_START=0) seed не запускається", async () => {
  assert.match(run({}), /вимкнено/);
  assert.match(run({ SEED_ON_START: "0" }), /вимкнено/);
  assert.deepEqual(await counts(), {
    users: 0,
    groups: 0,
    subjects: 0,
    labs: 0,
  });
});

test("з SEED_ON_START=1 — дані є; другий прогін не дублює", async () => {
  run({ SEED_ON_START: "1" });
  const first = await counts();
  assert.ok(first.users > 0 && first.labs > 0, JSON.stringify(first));
  run({ SEED_ON_START: "1" });
  assert.deepEqual(await counts(), first);
});
