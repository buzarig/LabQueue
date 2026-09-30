// Спільне для демонстрацій make verify (CHK-11): тимчасовий клон поточного
// HEAD, запуск команд, нормалізація виводу й запис звітів у reports/lab1/.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const root = resolve(".");
export const reports = join(root, "reports", "lab1");

/**
 * @typedef {{ code: number, output: string }} RunResult
 * @typedef {{ name: string, command: string, result: RunResult }} DemoCase
 */

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {RunResult}
 */
export function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 */
export function must(cmd, args, cwd) {
  const result = run(cmd, args, cwd);
  if (result.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} → ${result.code}\n${result.output}`,
    );
  }
  return result.output;
}

/**
 * Прибирає з виводу те, що змінюється від запуску до запуску (тимчасові шляхи,
 * тривалості, хеш бекапу lint-staged), щоб повторний make verify на тому ж
 * коміті не давав диффу в reports/ (standards/repo-hygiene.md).
 * @param {string} output
 * @param {string} [tmp]
 */
export function normalize(output, tmp) {
  const text = tmp ? output.replaceAll(tmp, "<tmp>") : output;
  return text
    .replace(/\(\d+(\.\d+)?ms\)/g, "(<ms>)")
    .replace(/duration_ms \d+(\.\d+)?/g, "duration_ms <ms>")
    .replace(/original state \([0-9a-f]+\)/g, "original state (<hash>)")
    .trimEnd();
}

/**
 * Тимчасовий клон HEAD з установленими пакетами. Робоче репо не змінюється.
 * @param {(sandbox: { tmp: string, repo: string }) => void} body
 */
export function withSandbox(body) {
  const tmp = mkdtempSync(join(tmpdir(), "labqueue-demo-"));
  const repo = join(tmp, "repo");
  try {
    must("git", ["clone", "--quiet", root, repo], tmp);
    must("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], repo);
    must("git", ["config", "user.name", "LabQueue demo"], repo);
    must("git", ["config", "user.email", "demo@labqueue.invalid"], repo);
    body({ tmp, repo });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Записує звіт. Кожен випадок має завершитися відмовою (код ≠ 0), інакше
 * демонстрація провалена і make verify падає.
 * @param {string} file
 * @param {string} title
 * @param {DemoCase[]} cases
 * @param {string} tmp
 */
export function writeReport(file, title, cases, tmp) {
  const sha = must("git", ["rev-parse", "HEAD"], root).trim();
  const lines = [
    `# ${title}`,
    `# Відтворення: make verify, вихідний коміт ${sha}`,
  ];
  for (const { name, command, result } of cases) {
    if (result.code === 0) {
      throw new Error(`${file} / ${name}: очікувалась відмова, але пройшло`);
    }
    lines.push(
      "",
      `## ${name}`,
      `# Команда: ${command}`,
      `# Код виходу: ${result.code} (очікувано ≠ 0 — відмова)`,
      "",
      normalize(result.output, tmp),
    );
  }
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, file), `${lines.join("\n")}\n`);
  console.log(`${file}: ${cases.length} відмов(и) зафіксовано`);
}
