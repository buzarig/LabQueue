// CHK-18 (К16): кількість SQL-запитів кожного сценарію при N = 1 і N = 10
// поряд із таблицею data.md → reports/<лаба>/queries.txt. Падає, якщо
// кількість залежить від N або розходиться з data.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectedFromDataMd,
  LARGE,
  measureAll,
  SMALL,
} from "../tests/db/queries.js";
import { must, reports, root } from "./demo-lib.js";

const sha = must("git", ["rev-parse", "HEAD"], root).trim();
const expected = expectedFromDataMd();
const rows = await measureAll();

const header = `| Сценарій | Усі, N=${SMALL} | Усі, N=${LARGE} | Доменні, N=${SMALL} | Доменні, N=${LARGE} | data.md | Висновок |`;
/** @type {string[]} */
const problems = [];
const table = rows.map(({ scenario, small, large }) => {
  const want = expected.get(scenario);
  const sameN = small.all === large.all && small.domain === large.domain;
  const sameSpec = small.domain === want;
  if (!sameN) problems.push(`${scenario}: залежить від N`);
  if (!sameSpec)
    problems.push(`${scenario}: ${small.domain} ≠ data.md ${want}`);
  const verdict = sameN && sameSpec ? "OK" : sameN ? "≠ data.md" : "N+1";
  return `| ${scenario} | ${small.all} | ${large.all} | ${small.domain} | ${large.domain} | ${want ?? "—"} | ${verdict} |`;
});

mkdirSync(reports, { recursive: true });
writeFileSync(
  join(reports, "queries.txt"),
  [
    "# К16: кількість SQL-запитів сценаріїв не залежить від кількості записів",
    `# Відтворення: make report-queries, вихідний коміт ${sha}`,
    "# Лічильник: onQuery у connectDb (debug драйвера), один HTTP-запит сценарію,",
    `# стан з N = ${SMALL} і N = ${LARGE} (записи в черзі, заняття групи, історія), кожне вимірювання — на власній БД.`,
    "# «Усі» — разом із begin/commit/savepoint і ключем ідемпотентності; «доменні» — без них",
    "# і без службових запитів драйвера до pg_catalog; data.md — таблиця «Запити сценаріїв».",
    "",
    header,
    "|---|---|---|---|---|---|---|",
    ...table,
    "",
    problems.length === 0
      ? "Підсумок: у всіх 13 сценаріях кількість однакова при обох N і збігається з data.md — N+1 немає."
      : `Підсумок: ПРОБЛЕМИ — ${problems.join("; ")}`,
    "",
  ].join("\n"),
);
if (problems.length > 0) {
  console.error(`queries.txt: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`queries.txt: 13 сценаріїв без N+1 на ${sha.slice(0, 7)}`);
