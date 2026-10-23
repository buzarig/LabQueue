// CHK-16 (К9): прогін сценарної сюїти на статиці (STORAGE=memory) →
// reports/<лаба>/scenarios-memory.txt. Падає, якщо хоч один сценарій упав.
// Відтворення: make report-scenarios (або make verify).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { must, normalize, reports, root } from "./demo-lib.js";
import { spawnSync } from "node:child_process";

const STORAGE = "memory";
const sha = must("git", ["rev-parse", "HEAD"], root).trim();
const result = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=spec", "tests/scenarios/**/*.test.js"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, STORAGE, NO_COLOR: "1" },
  },
);
const code = result.status ?? 1;
const output = normalize(`${result.stdout ?? ""}${result.stderr ?? ""}`);

const text = [
  `# К9: сценарна сюїта S1–S13 і каталог помилок на статиці (STORAGE=${STORAGE})`,
  `# Відтворення: make report-scenarios, вихідний коміт ${sha}`,
  `# Команда: node --test tests/scenarios/**/*.test.js`,
  `# Код виходу: ${code} (очікувано 0)`,
  "",
  output,
  "",
].join("\n");

mkdirSync(reports, { recursive: true });
writeFileSync(join(reports, `scenarios-${STORAGE}.txt`), text);
if (code !== 0) {
  console.error(output);
  console.error(`scenarios-${STORAGE}.txt: сюїта впала (код ${code})`);
  process.exit(1);
}
console.log(`scenarios-${STORAGE}.txt: сюїта зелена на ${sha.slice(0, 7)}`);
