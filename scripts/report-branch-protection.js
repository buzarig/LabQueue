// MAN-09: доказ branch protection — вивід gh api …/rulesets у
// reports/lab1/branch-protection.txt. Без gh або доступу до репо звіт не
// оновлюється, make verify не падає (відповідь автора, промпт 015).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reports, root, run } from "./demo-lib.js";

const FILE = "branch-protection.txt";

/** @param {string[]} args */
function gh(args) {
  return run("gh", args, root);
}

const repo = gh([
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "-q",
  ".nameWithOwner",
]);
const list =
  repo.code === 0 ? gh(["api", `repos/${repo.output.trim()}/rulesets`]) : repo;
if (repo.code !== 0 || list.code !== 0) {
  console.log(`${FILE}: gh недоступний — звіт не оновлено`);
  process.exit(0);
}

const name = repo.output.trim();
/** @type {Array<{ id: number }>} */
const rulesets = JSON.parse(list.output);
const details = rulesets.map((ruleset) => {
  const detail = gh(["api", `repos/${name}/rulesets/${ruleset.id}`]);
  if (detail.code !== 0) throw new Error(detail.output);
  return JSON.parse(detail.output);
});

const summary = details.map((/** @type {any} */ d) => {
  /** @param {string} type */
  const rule = (type) =>
    d.rules.find((/** @type {any} */ r) => r.type === type);
  const checks = rule(
    "required_status_checks",
  )?.parameters.required_status_checks.map((/** @type {any} */ c) => c.context);
  const methods = rule("pull_request")?.parameters.allowed_merge_methods;
  return [
    `- ${d.name} (${d.enforcement}), гілки: ${d.conditions.ref_name.include.join(", ")}`,
    `  правила: ${d.rules.map((/** @type {any} */ r) => r.type).join(", ")}`,
    `  обов'язкові перевірки: ${checks?.join(", ") ?? "немає"}`,
    `  дозволені способи merge: ${methods?.join(", ") ?? "не обмежено"}`,
  ].join("\n");
});

const text = [
  "# MAN-09: branch protection (ruleset-и репозиторію)",
  `# Відтворення: make verify; джерело: gh api repos/${name}/rulesets`,
  "",
  "## Підсумок",
  ...summary,
  "",
  "## gh api …/rulesets/<id>",
  JSON.stringify(details, null, 2),
  "",
].join("\n");
writeFileSync(join(reports, FILE), text);
console.log(`${FILE}: ${summary.join("\n")}`);
