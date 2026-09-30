// CHK-11 (К7): відтворює відмови hook-ів і пише реальний вивід у reports/lab1/.
// Працює в тимчасовому клоні поточного HEAD — робоче репо не змінюється.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(".");
const reports = join(root, "reports", "lab1");
const tmp = mkdtempSync(join(tmpdir(), "labqueue-demo-"));
const repo = join(tmp, "repo");

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(cmd, args, cwd = repo) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [cwd]
 */
function must(cmd, args, cwd) {
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
 */
function normalize(output) {
  return output
    .replaceAll(tmp, "<tmp>")
    .replace(/\(\d+(\.\d+)?ms\)/g, "(<ms>)")
    .replace(/duration_ms \d+(\.\d+)?/g, "duration_ms <ms>")
    .replace(/original state \([0-9a-f]+\)/g, "original state (<hash>)")
    .trimEnd();
}

/**
 * Записує звіт. Очікується відмова (ненульовий код), інакше демо провалене.
 * @param {string} file
 * @param {string} title
 * @param {string} command
 * @param {{ code: number, output: string }} result
 */
function report(file, title, command, result) {
  if (result.code === 0) {
    throw new Error(`${title}: очікувалась відмова, але команда пройшла`);
  }
  const sha = must("git", ["rev-parse", "HEAD"], root).trim();
  const text = [
    `# ${title}`,
    `# Відтворення: make verify (scripts/demo-hooks.js), вихідний коміт ${sha}`,
    `# Команда: ${command}`,
    `# Код виходу: ${result.code} (очікувано ≠ 0 — hook відхилив)`,
    "",
    normalize(result.output),
    "",
  ].join("\n");
  writeFileSync(join(reports, file), text);
  console.log(`${file}: відмова зафіксована (код ${result.code})`);
}

try {
  mkdirSync(reports, { recursive: true });
  must("git", ["clone", "--quiet", root, repo], tmp);
  must("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"]);
  must("git", ["config", "user.name", "LabQueue demo"]);
  must("git", ["config", "user.email", "demo@labqueue.invalid"]);

  // Демо 1: коміт з порушенням стилю → pre-commit (lint-staged) відхиляє.
  writeFileSync(
    join(repo, "src/platform/demo-bad-style.js"),
    "export const demo = {a:1}\n",
  );
  must("git", ["add", "src/platform/demo-bad-style.js"]);
  report(
    "hook-pre-commit.txt",
    "К7: коміт з порушенням стилю відхиляється pre-commit",
    'git commit -m "chore: демо коміту з порушенням стилю"',
    run("git", ["commit", "-m", "chore: демо коміту з порушенням стилю"]),
  );
  must("git", ["rm", "--quiet", "--cached", "src/platform/demo-bad-style.js"]);
  rmSync(join(repo, "src/platform/demo-bad-style.js"));

  // Демо 2: пуш зі зламаним smoke-тестом → pre-push (make check) відхиляє.
  const server = join(repo, "src/platform/server.js");
  const source = readFileSync(server, "utf8");
  const broken = source.replace('({ status: "ok" })', '({ status: "broken" })');
  if (broken === source)
    throw new Error("не знайшов відповідь /health для демо");
  writeFileSync(server, broken);
  must("git", ["commit", "--quiet", "-am", "test: демо зламаного smoke-тесту"]);
  must("git", ["init", "--quiet", "--bare", join(tmp, "remote.git")], tmp);
  must("git", ["remote", "add", "demo", join(tmp, "remote.git")]);
  report(
    "hook-pre-push.txt",
    "К7: пуш зі зламаним smoke-тестом відхиляється pre-push",
    "git push demo HEAD",
    run("git", ["push", "demo", "HEAD"]),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
