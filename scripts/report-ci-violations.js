// Аудит CI лаби 4 (spec, критерій 13): PR із навмисними порушеннями —
// формат, лінт, типи, тест, збірка, повідомлення коміту. Для кожного: стан
// PR, висновок перевірки `check`, ціль make, на якій CI зупинився, рядок
// помилки з логу й стан злиття. Пише reports/<лаба>/ci-violations.txt.
// Падає, якщо хоч один такий PR злитий, його `check` не червоний або CI
// упав не на очікуваній цілі.
//
//   make report-ci-violations   (потрібен gh з доступом до репозиторію)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, reports, root, run } from "./demo-lib.js";

const TITLE = "[аудит CI, не зливати]";
/** Очікувана ціль make для кожного порушення — за назвою PR. */
const EXPECTED = [
  ["формат", "format"],
  ["лінт", "lint"],
  ["типи", "typecheck"],
  ["тест", "test"],
  ["збірка", "build"],
  ["повідомлення коміту", "commits"],
];
/** Кольорові коди терміналу (ESC [ … m і їхній текстовий запис ^[[ … m). */
const ANSI = new RegExp(`(${String.fromCharCode(27)}|\\^\\[)\\[[0-9;]*m`, "g");
/** Рядки логу, які пояснюють падіння. */
const EVIDENCE =
  /make: \*\*\*|error +'|error TS\d+|✖ (?!failing)|\[ERROR\]|CHK-08:|Code style issues/;

/** @param {string[]} args */
const gh = (args) => must("gh", args, root);

const repo = gh([
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "-q",
  ".nameWithOwner",
]).trim();
/** @type {Array<{ number: number, title: string, state: string, mergedAt: string | null, headRefOid: string, mergeStateStatus: string }>} */
const prs = JSON.parse(
  gh([
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number,title,state,mergedAt,headRefOid,mergeStateStatus",
  ]),
)
  .filter((/** @type {{ title: string }} */ pr) => pr.title.startsWith(TITLE))
  .sort((/** @type {any} */ a, /** @type {any} */ b) => a.number - b.number);

/** @type {string[]} */
const problems = [];
const blocks = prs.map((pr) => {
  /** @type {{ check_runs: Array<{ name: string, conclusion: string, details_url: string }> }} */
  const checks = JSON.parse(
    gh(["api", `repos/${repo}/commits/${pr.headRefOid}/check-runs`]),
  );
  const check = checks.check_runs.find((c) => c.name === "check");
  const runId = check?.details_url.match(/\/runs\/(\d+)/)?.[1] ?? "";
  const log = runId
    ? run("gh", ["run", "view", runId, "--log-failed"], root).output
    : "";
  const lines = log
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.split("\t").at(-1) ?? "")
    .map((line) => line.replace(/^\S+Z /, "").replace(/^##\[error\]/, ""))
    .filter((line) => EVIDENCE.test(line))
    .map((line) => line.replace(/\(\d+(\.\d+)?ms\)/, "(<ms>)").trim())
    .filter((line, i, all) => all.indexOf(line) === i);
  const target = lines
    .map((line) => line.match(/make: \*\*\* \[Makefile:\d+: (\S+)\]/)?.[1])
    .find(Boolean);
  const expected = EXPECTED.find(([word]) => pr.title.includes(word))?.[1];
  if (pr.mergedAt) problems.push(`#${pr.number}: PR злитий`);
  if (check?.conclusion !== "failure") {
    problems.push(`#${pr.number}: check = ${check?.conclusion ?? "немає"}`);
  }
  if (target !== expected) {
    problems.push(`#${pr.number}: ціль ${target}, очікувалась ${expected}`);
  }
  const merge =
    pr.state === "OPEN"
      ? `відкритий, mergeStateStatus=${pr.mergeStateStatus}`
      : pr.mergedAt
        ? "ЗЛИТИЙ"
        : "закритий без злиття";
  return [
    `## #${pr.number} ${pr.title.slice(TITLE.length).trim()}`,
    `коміт: ${pr.headRefOid}`,
    `check: ${check?.conclusion ?? "немає"} (run ${runId})`,
    `make зупинився на: ${target ?? "—"} (очікувалось: ${expected ?? "—"})`,
    `злиття: ${merge}`,
    "лог:",
    ...lines.map((line) => `  ${line}`),
    "",
  ].join("\n");
});

if (prs.length !== EXPECTED.length) {
  problems.push(`PR «${TITLE}»: ${prs.length}, очікувалось ${EXPECTED.length}`);
}

const text = [
  "# К13 лаби 4: CI падає на навмисних порушеннях і блокує злиття",
  `# Відтворення: make report-ci-violations; PR із назвою «${TITLE} …»`,
  "# Коміти зроблено й запушено з --no-verify, в обхід локальних hook-ів.",
  "# Злиття блокує ruleset main (обов'язкова перевірка check, branch-protection.txt).",
  "",
  ...blocks,
].join("\n");
mkdirSync(reports, { recursive: true });
writeFileSync(join(reports, "ci-violations.txt"), text);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ci-violations.txt: ${prs.length} PR, усі червоні й не злиті`);
