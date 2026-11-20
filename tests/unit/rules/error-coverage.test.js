// Перевірка К8 падає, якщо в каталозі data.md з'явився код без сценарного
// тесту (standards/checks.md, «Перевірка має доведено падати»).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseErrorCatalog,
  uncoveredCodes,
} from "../../scenarios/error-catalog.js";

const SAMPLE = `# x

## Каталог помилок

| Код | HTTP | Умова | Сценарії |
|---|---|---|---|
| QUEUE_EMPTY | 409 | немає записів waiting | S5 |
| SESSION_NOT_FOUND / ENTRY_NOT_FOUND | 404 | немає такого id | S2 |
| NEW_CODE | 418 | новий код без тесту | S1 |

Порядок перевірок…

## Міграції
`;

test("каталог розбирається з таблиці, включно з двома кодами в одній клітинці", () => {
  assert.deepEqual(
    [...parseErrorCatalog(SAMPLE)],
    [
      ["QUEUE_EMPTY", 409],
      ["SESSION_NOT_FOUND", 404],
      ["ENTRY_NOT_FOUND", 404],
      ["NEW_CODE", 418],
    ],
  );
});

test("код без тесту й без винятку — непокритий", () => {
  const catalog = parseErrorCatalog(SAMPLE);
  assert.deepEqual(
    uncoveredCodes(
      catalog,
      ["QUEUE_EMPTY", "SESSION_NOT_FOUND"],
      ["ENTRY_NOT_FOUND"],
    ),
    ["NEW_CODE"],
  );
});

test("справжній data.md: 26 кодів, жодного без статусу", () => {
  const catalog = parseErrorCatalog();
  assert.equal(catalog.size, 26);
  assert.equal(catalog.get("ROUTE_NOT_FOUND"), 404);
  assert.equal(catalog.get("SOURCE_UNAVAILABLE"), 503);
});
