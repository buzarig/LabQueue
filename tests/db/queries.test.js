// К16: кількість SQL-запитів кожного сценарію не залежить від кількості
// записів — немає N+1; доменна кількість збігається з таблицею «Запити
// сценаріїв» у data.md — таблиця є перевіреним контрактом (аудит, кандидат 4).
// Звіт із тими самими числами — reports/lab2/queries.txt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedFromDataMd, LARGE, measureAll, SMALL } from "./queries.js";

test(`К16: N = ${SMALL} і N = ${LARGE} — однакова кількість запитів, як у data.md`, async () => {
  const expected = expectedFromDataMd();
  const rows = await measureAll();
  assert.equal(rows.length, 13);
  for (const { scenario, small, large } of rows) {
    assert.ok(
      small.status < 400,
      `${scenario}: N=${SMALL} відповів ${small.status}`,
    );
    assert.ok(
      large.status < 400,
      `${scenario}: N=${LARGE} відповів ${large.status}`,
    );
    assert.equal(
      large.all,
      small.all,
      `${scenario}: ${small.all} → ${large.all} запитів`,
    );
    assert.equal(
      small.domain,
      expected.get(scenario),
      `${scenario}: у коді ${small.domain} доменних запитів, у data.md ${expected.get(scenario)}`,
    );
  }
});
