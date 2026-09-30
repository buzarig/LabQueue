// CHK-13: регресія перевірки JSDoc (ADR-0020). tsc має знайти помилку рівно в
// кожному рядку з міткою ERR у fixture/probe.js — не менше й не більше.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const PROBE = "tests/typecheck/fixture/probe.js";

test("tsc --checkJs ловить помилку в кожній JSDoc-конструкції проби", () => {
  const expected = readFileSync(PROBE, "utf8")
    .split("\n")
    .flatMap((line, i) => (/\/\/ ERR\b/.test(line) ? [i + 1] : []));

  const result = spawnSync(
    "npx",
    ["tsc", "-p", "tests/typecheck/fixture/tsconfig.json"],
    { encoding: "utf8" },
  );
  const reported = [
    ...new Set(
      [...result.stdout.matchAll(/probe\.js\((\d+),\d+\): error/g)].map((m) =>
        Number(m[1]),
      ),
    ),
  ].sort((a, b) => a - b);

  assert.notEqual(result.status, 0, "tsc мав завершитися з помилками");
  assert.equal(expected.length, 8, "у пробі має бути 8 міток ERR");
  assert.deepEqual(reported, expected, result.stdout);
});
