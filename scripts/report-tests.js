// Звіти прогонів тестів для make verify (CHK-16, CHK-18): весь вивід
// node --test, код виходу й sha. Падає, якщо прогін упав.
//
//   node scripts/report-tests.js scenarios-memory | scenarios-pg | failures
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, normalize, reports, root } from "./demo-lib.js";

/** @type {Record<string, { title: string, glob: string, env: Record<string, string> }>} */
const REPORTS = {
  "scenarios-memory": {
    title:
      "К9: сценарна сюїта S1–S13 і каталог помилок на статиці (STORAGE=memory)",
    glob: "tests/scenarios/**/*.test.js",
    env: { STORAGE: "memory" },
  },
  "scenarios-pg": {
    title: "К10: та сама сценарна сюїта на PostgreSQL (STORAGE=pg)",
    glob: "tests/scenarios/**/*.test.js",
    env: { STORAGE: "pg" },
  },
  failures: {
    title:
      "К14: збої джерела через HTTP на PostgreSQL (обрив, таймаут, друга лінія, недоступність)",
    glob: "tests/db/failures.test.js",
    env: {},
  },
};

const name = process.argv[2] ?? "";
const report = REPORTS[name];
if (!report) {
  console.error(
    `використання: node scripts/report-tests.js ${Object.keys(REPORTS).join(" | ")}`,
  );
  process.exit(1);
}

const sha = must("git", ["rev-parse", "HEAD"], root).trim();
const result = spawnSync(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--test",
    "--test-reporter=spec",
    "--test-timeout=60000",
    report.glob,
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...report.env, NO_COLOR: "1" },
  },
);
const code = result.status ?? 1;
const output = normalize(`${result.stdout ?? ""}${result.stderr ?? ""}`);

mkdirSync(reports, { recursive: true });
writeFileSync(
  join(reports, `${name}.txt`),
  [
    `# ${report.title}`,
    `# Відтворення: make report-${name}, вихідний коміт ${sha}`,
    `# Команда: node --test ${report.glob}${Object.entries(report.env)
      .map(([k, v]) => ` (${k}=${v})`)
      .join("")}`,
    `# Код виходу: ${code} (очікувано 0)`,
    "",
    output,
    "",
  ].join("\n"),
);
if (code !== 0) {
  console.error(output);
  console.error(`${name}.txt: прогін упав (код ${code})`);
  process.exit(1);
}
console.log(`${name}.txt: зелено на ${sha.slice(0, 7)}`);
