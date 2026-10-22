// CHK-09: гігієна відстежуваних файлів. Правила й списки — standards/repo-hygiene.md.
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/** Заборонені шаблони (таблиця «Що не потрапляє в репозиторій»). */
const FORBIDDEN = [
  /(^|\/)node_modules\//,
  /^dist\//,
  /^coverage\//,
  /\.tsbuildinfo$/,
  /\.log$/,
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.DS_Store$/,
  /^\.idea\//,
  /^\.vscode\//,
  /^\.claude\/settings\.local\.json$/,
];
const FORBIDDEN_EXCEPT = [/(^|\/)\.env\.example$/];

/** Дозволені файли без розширення (розділ «Файли без розширення»). */
const EXTENSIONLESS_ALLOWED = new Set([
  "Makefile",
  "LICENSE",
  ".gitignore",
  ".nvmrc",
  ".editorconfig",
  ".husky/pre-commit",
  ".husky/commit-msg",
  ".husky/pre-push",
]);

/** @param {string} path */
function hasExtension(path) {
  const name = basename(path);
  return name.lastIndexOf(".") > 0;
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/** @type {string[]} */
const problems = [];
for (const file of files) {
  const forbidden =
    FORBIDDEN.some((re) => re.test(file)) &&
    !FORBIDDEN_EXCEPT.some((re) => re.test(file));
  if (forbidden) {
    problems.push(`заборонений файл у git: ${file}`);
  } else if (!hasExtension(file) && !EXTENSIONLESS_ALLOWED.has(file)) {
    problems.push(`файл без розширення не з дозволеного списку: ${file}`);
  }
}

if (problems.length > 0) {
  console.error(
    `CHK-09 (standards/repo-hygiene.md):\n  ${problems.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`CHK-09: ${files.length} відстежуваних файлів — OK`);
