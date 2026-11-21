// make verify: брама (make check) + усі звіти (CHK-11, MAN-09) + дата й sha (CHK-12)
// у reports/<лаба>/verify.txt. На цей файл посилається DEFENSE.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, normalize, reports, root, run } from "./demo-lib.js";

/** @param {string} title @param {string} cmd @param {string[]} args */
function step(title, cmd, args) {
  console.log(`\n== ${title}`);
  const result = run(cmd, args, root);
  process.stdout.write(result.output);
  if (result.code !== 0) {
    console.error(`make verify: «${title}» завершився з кодом ${result.code}`);
    process.exit(1);
  }
  return result.output;
}

const sha = must("git", ["rev-parse", "HEAD"], root).trim();
const dirty = must(
  "git",
  ["status", "--porcelain", "--", ".", ":!reports"],
  root,
)
  .trim()
  .split("\n")
  .filter(Boolean);

const check = step("make check", "make", ["check"]);
// Одразу після make check: зведення покриття бере дані його make test.
const coverage = step("К11–К12 лаби 3: покриття", "node", [
  "scripts/report-coverage.js",
]);
const hooks = step("К7: відмови hook-ів", "node", ["scripts/demo-hooks.js"]);
const bounds = step("К10: порушення меж", "node", [
  "scripts/demo-boundaries.js",
]);
const protection = step("MAN-09: branch protection", "node", [
  "scripts/report-branch-protection.js",
]);
const scenarios = step("К9: сценарії на статиці", "node", [
  "scripts/report-tests.js",
  "scenarios-memory",
]);
const scenariosPg = step("К10: сценарії на PostgreSQL", "node", [
  "scripts/report-tests.js",
  "scenarios-pg",
]);
const failures = step("К14: збої джерела", "node", [
  "scripts/report-tests.js",
  "failures",
]);
const unit = step("К4–К6 лаби 3: unit", "node", [
  "scripts/report-tests.js",
  "unit",
]);
const db = step("К7–К8 лаби 3: integration на PostgreSQL", "node", [
  "scripts/report-tests.js",
  "db",
]);
const e2e = step("К9–К10 лаби 3: E2E", "node", [
  "scripts/report-tests.js",
  "e2e",
]);
const mutation = step("К13–К14 лаби 3: мутації", "make", [
  "--no-print-directory",
  "mutation",
]);
const queries = step("К16: запити без N+1", "node", [
  "--env-file-if-exists=.env",
  "scripts/report-queries.js",
]);

const text = [
  "# make verify — звіт для DEFENSE",
  `дата:  ${new Date().toISOString()}`,
  `sha:   ${sha}`,
  `дерево: ${dirty.length === 0 ? "чисте (без урахування reports/)" : `є незакомічені зміни — ${dirty.join(", ")}`}`,
  "",
  "Sha — коміт, на якому запускали verify. Коміт із цим звітом іде одразу після нього.",
  "",
  "## make check",
  normalize(check),
  "",
  "## Звіти (CHK-11)",
  hooks.trim(),
  bounds.trim(),
  protection.trim(),
  scenarios.trim(),
  scenariosPg.trim(),
  failures.trim(),
  queries.trim(),
  unit.trim(),
  db.trim(),
  e2e.trim(),
  coverage.trim(),
  mutation.trim().split("\n").at(-1),
  "",
].join("\n");
writeFileSync(join(reports, "verify.txt"), text);
console.log(`\nverify.txt записано. sha ${sha}`);
