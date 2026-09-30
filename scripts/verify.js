// make verify: брама (make check) + усі звіти (CHK-11, MAN-09) + дата й sha (CHK-12)
// у reports/lab1/verify.txt. На цей файл посилається DEFENSE.
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
const hooks = step("К7: відмови hook-ів", "node", ["scripts/demo-hooks.js"]);
const bounds = step("К10: порушення меж", "node", [
  "scripts/demo-boundaries.js",
]);
const protection = step("MAN-09: branch protection", "node", [
  "scripts/report-branch-protection.js",
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
  "",
].join("\n");
writeFileSync(join(reports, "verify.txt"), text);
console.log(`\nverify.txt записано. sha ${sha}`);
