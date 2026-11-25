// readConfig (platform/config.js): типові значення й відмови для PORT, STORAGE,
// DATABASE_URL і HOST (ADR-0043: у контейнері застосунок слухає `::`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../../../src/platform/config.js";

const PG = { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" };

test("типово: localhost:3000, pg", () => {
  assert.deepEqual(readConfig(PG), {
    host: "localhost",
    port: 3000,
    storage: "pg",
    databaseUrl: PG.DATABASE_URL,
  });
});

test("HOST і PORT з оточення; порожній HOST — типовий localhost", () => {
  const config = readConfig({ ...PG, HOST: "::", PORT: "8080" });
  assert.equal(config.host, "::");
  assert.equal(config.port, 8080);
  assert.equal(readConfig({ ...PG, HOST: "" }).host, "localhost");
});

test("PORT — ціле 0–65535, інакше помилка з отриманим значенням", () => {
  for (const PORT of ["abc", "-1", "65536", "1.5"]) {
    assert.throws(() => readConfig({ ...PG, PORT }), {
      message: `PORT має бути цілим числом 0–65535, отримано: ${PORT}`,
    });
  }
});

test("STORAGE — лише memory або pg; pg без DATABASE_URL — помилка", () => {
  assert.equal(readConfig({ STORAGE: "memory" }).storage, "memory");
  assert.throws(() => readConfig({ STORAGE: "sqlite" }), /STORAGE має бути/);
  assert.throws(() => readConfig({}), /STORAGE=pg потребує DATABASE_URL/);
});
