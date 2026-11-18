// Звіт мутаційного тестування transitions.js (spec лаби 3, критерії 13–14;
// ADR-0040). Бере JSON-звіт Stryker і класифікацію вижилих з
// tests/vitest/transitions.survivors.json, пише reports/<лаба>/mutation.txt.
// Падає, якщо вижилий мутант не класифікований або класифікація описує
// мутанта, якого вже немає: звіт не може тихо розійтися з кодом.
//
//   make mutation  (stryker run, потім цей скрипт)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, reports, root } from "./demo-lib.js";

const STRYKER_JSON = join(root, "coverage/mutation/mutation.json");
const SURVIVORS = "tests/vitest/transitions.survivors.json";
const CLASSES = ["реальна прогалина", "еквівалентний", "прийнятний"];
/** Статуси, які означають «тести мутанта не вбили». */
const NOT_KILLED = ["Survived", "NoCoverage"];

/**
 * @typedef {{
 *   id: string,
 *   mutatorName: string,
 *   replacement?: string,
 *   status: string,
 *   location: { start: { line: number, column: number } },
 * }} Mutant
 * @typedef {{
 *   mutator: string,
 *   line: number,
 *   replacement: string,
 *   class: string,
 *   reason: string,
 * }} Classified
 */

/** @type {{ files: Record<string, { mutants: Mutant[] }> }} */
const result = JSON.parse(readFileSync(STRYKER_JSON, "utf8"));
/** @type {Classified[]} */
const classified = JSON.parse(readFileSync(join(root, SURVIVORS), "utf8"));

/** @param {{ mutator: string, line: number, replacement?: string }} m */
const key = (m) => `${m.mutator}:${m.line}:${m.replacement ?? ""}`;

const files = Object.entries(result.files);
const mutants = files.flatMap(([, file]) => file.mutants);
const survivors = mutants
  .filter((m) => NOT_KILLED.includes(m.status))
  .map((m) => ({
    mutator: m.mutatorName,
    line: m.location.start.line,
    column: m.location.start.column,
    replacement: m.replacement,
    status: m.status,
  }))
  .sort((a, b) => a.line - b.line || a.column - b.column);

const byKey = new Map(classified.map((c) => [key(c), c]));
const problems = [
  ...survivors
    .filter((s) => !byKey.has(key(s)))
    .map((s) => `не класифікований: ${key(s)}`),
  ...classified
    .filter((c) => !survivors.some((s) => key(s) === key(c)))
    .map((c) => `класифікація без мутанта: ${key(c)}`),
  ...classified
    .filter((c) => !CLASSES.includes(c.class))
    .map((c) => `невідомий клас «${c.class}»: ${key(c)}`),
];

/** @type {Record<string, number>} */
const byStatus = {};
for (const m of mutants) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
const killed = (byStatus.Killed ?? 0) + (byStatus.Timeout ?? 0);
const valid = mutants.filter(
  (m) => !["CompileError", "RuntimeError", "Ignored"].includes(m.status),
).length;
const score = valid === 0 ? 0 : (100 * killed) / valid;

const sha = must("git", ["rev-parse", "HEAD"], root).trim();
const lines = [
  "# К13–К14 лаби 3: мутаційне тестування transitions.js (Stryker + Vitest)",
  `# Відтворення: make mutation, вихідний коміт ${sha}`,
  `# Файли: ${files.map(([f]) => f).join(", ")}`,
  `# Класифікація вижилих: ${SURVIVORS}`,
  "",
  `Мутантів: ${mutants.length}`,
  ...Object.entries(byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `  ${status}: ${n}`),
  `Оцінка мутацій: ${score.toFixed(2)} % (убиті й таймаути / усі валідні)`,
  "",
  `Вижилі (${survivors.length}) за класами:`,
  ...CLASSES.map(
    (c) => `  ${c}: ${classified.filter((x) => x.class === c).length}`,
  ),
  "",
  ...survivors.flatMap((s) => {
    const c = byKey.get(key(s));
    return [
      `- ${s.status} ${s.mutator} рядок ${s.line}:${s.column} → ${s.replacement ?? ""}`,
      `  клас: ${c?.class ?? "НЕ КЛАСИФІКОВАНО"}`,
      `  чому: ${c?.reason ?? "—"}`,
    ];
  }),
  "",
];

mkdirSync(reports, { recursive: true });
writeFileSync(join(reports, "mutation.txt"), lines.join("\n"));
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    `mutation.txt: класифікація розійшлася зі звітом Stryker — ${SURVIVORS}`,
  );
  process.exit(1);
}
console.log(
  `mutation.txt: ${score.toFixed(2)} %, вижилих ${survivors.length}, усі класифіковані`,
);
