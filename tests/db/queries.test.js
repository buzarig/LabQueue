// К16: кількість SQL-запитів кожного сценарію не залежить від кількості
// записів — немає N+1. Звіт із тими самими числами — reports/lab2/queries.txt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LARGE, measureAll, SMALL } from "./queries.js";

test(`К16: N = ${SMALL} і N = ${LARGE} — однакова кількість запитів у кожному сценарії`, async () => {
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
  }
});
