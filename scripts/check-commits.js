// CHK-07 (трейлер Prompt у комітах ШІ) і CHK-08 (формат повідомлення).
// Правила — standards/commits.md, standards/checks.md.
//
//   node scripts/check-commits.js                 перевіряє історію main..HEAD
//   node scripts/check-commits.js --msg-file F    перевіряє одне повідомлення (commit-msg hook)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "docs", "chore", "test", "ci", "refactor"];
const SUBJECT = new RegExp(`^(${TYPES.join("|")})(\\([^)]+\\))?: (.+)$`);
const CYRILLIC = /[А-ЩЬЮЯҐЄІЇа-щьюяґєії]/;
const AI_TRAILER = /^Co-Authored-By:.*<noreply@anthropic\.com>\s*$/im;
const PROMPT_LINE = /^Prompt:\s*(.*)$/gm;
const PROMPT_PATH = /^ai\/lab\d+\/\d{3}-[^\s/]+\.md$/;

/**
 * Відомі історичні порушення, зроблені до появи цієї перевірки. Історію не
 * переписуємо (sha в аудиті й spec-fix мають лишитися дійсними), тому коміт
 * пропускається явно. Кожен запис — з посиланням на кандидата в аудиті.
 * Нові порушення сюди не додаються без промпту автора.
 */
const KNOWN_VIOLATIONS = new Map([
  [
    "ca2d00830ff2252285cebf988a869f65eef28823",
    "CHK-08: опис без кирилиці — docs/audit/lab1.md, кандидат 4",
  ],
]);

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * Автоматичні коміти git (Merge…, Revert "…") не перевіряються (промпт 007).
 * @param {string} subject
 */
function isAutoCommit(subject) {
  return subject.startsWith("Merge ") || subject.startsWith('Revert "');
}

/**
 * @param {string} message повне повідомлення коміту
 * @param {(path: string) => boolean} promptExists
 * @returns {string[]} порушення
 */
function checkMessage(message, promptExists) {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const text = lines.join("\n").trim();
  const subject = lines[0]?.trim() ?? "";
  if (isAutoCommit(subject)) return [];

  /** @type {string[]} */
  const problems = [];
  const match = SUBJECT.exec(subject);
  if (!match) {
    problems.push(
      `CHK-08: заголовок не у форматі «тип(область)?: опис», типи: ${TYPES.join(", ")}`,
    );
  } else if (!CYRILLIC.test(match[3])) {
    problems.push("CHK-08: опис має бути українською (немає кирилиці)");
  }

  if (AI_TRAILER.test(text)) {
    const prompts = [...text.matchAll(PROMPT_LINE)].map((m) => m[1].trim());
    if (prompts.length === 0) {
      problems.push(
        "CHK-07: коміт ШІ без трейлера «Prompt: ai/labN/NNN-назва.md»",
      );
    }
    for (const path of prompts) {
      if (!PROMPT_PATH.test(path)) {
        problems.push(
          `CHK-07: трейлер Prompt не у форматі ai/labN/NNN-назва.md: ${path}`,
        );
      } else if (!promptExists(path)) {
        problems.push(`CHK-07: файл промпту не існує: ${path}`);
      }
    }
  }
  return problems;
}

/** База історії: origin/main (CI) або main (локально). */
function baseRef() {
  for (const ref of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      // пробуємо наступний
    }
  }
  throw new Error(
    "не знайдено гілку main чи origin/main для діапазону main..HEAD",
  );
}

const fileArg = process.argv.indexOf("--msg-file");
/** @type {string[]} */
const report = [];

if (fileArg !== -1) {
  const message = readFileSync(process.argv[fileArg + 1], "utf8");
  for (const problem of checkMessage(message, (path) => existsSync(path))) {
    report.push(problem);
  }
} else {
  const range = `${baseRef()}..HEAD`;
  const shas = git(["rev-list", "--reverse", range])
    .split("\n")
    .filter(Boolean);
  for (const sha of shas) {
    if (KNOWN_VIOLATIONS.has(sha)) continue;
    const message = git(["log", "-1", "--format=%B", sha]);
    const exists = (/** @type {string} */ path) => {
      try {
        git(["cat-file", "-e", `${sha}:${path}`]);
        return true;
      } catch {
        return false;
      }
    };
    for (const problem of checkMessage(message, exists)) {
      report.push(
        `${sha.slice(0, 7)} ${message.split("\n")[0]}\n    ${problem}`,
      );
    }
  }
  if (report.length === 0) {
    console.log(`CHK-07/08: ${shas.length} комітів у ${range} — OK`);
  }
}

if (report.length > 0) {
  console.error(report.join("\n"));
  process.exit(1);
}
