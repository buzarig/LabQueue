// Звіти покриття c8 (spec лаби 3, критерії 11–12; ADR-0039):
//   coverage-src.txt         — src/ за unit та integration; дані лишає make test
//                              у coverage/src/tmp, тут лише зведення без порогу;
//   coverage-transitions.txt — Vitest-тести transitions.js з порогом гілок і
//                              функцій 80 % (npm run test:transitions).
// Падає, якщо даних make test немає або поріг не виконано.
//
//   make report-coverage  (make test, потім цей скрипт)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, normalize, reports, root, run } from "./demo-lib.js";

const TMP = "coverage/src/tmp";
if (!existsSync(join(root, TMP))) {
  console.error(`${TMP} не знайдено — спершу make test`);
  process.exit(1);
}

const sha = must("git", ["rev-parse", "HEAD"], root).trim();
mkdirSync(reports, { recursive: true });

const src = run(
  "node_modules/.bin/c8",
  [
    "report",
    "--include",
    "src/**",
    "--temp-directory",
    TMP,
    "--reporter",
    "text",
  ],
  root,
);
const transitions = run("npm", ["run", "--silent", "test:transitions"], root);

writeFileSync(
  join(reports, "coverage-src.txt"),
  [
    "# К11 лаби 3: покриття src/ за unit та integration (c8, без порогу)",
    `# Відтворення: make report-coverage, вихідний коміт ${sha}`,
    `# Команда: c8 report --include "src/**" --temp-directory ${TMP} (дані — make test)`,
    `# Код виходу: ${src.code} (очікувано 0)`,
    "",
    normalize(src.output),
    "",
  ].join("\n"),
);
writeFileSync(
  join(reports, "coverage-transitions.txt"),
  [
    "# К12 лаби 3: покриття transitions.js Vitest-тестами, поріг гілок і функцій 80 % (ціль 100 %)",
    `# Відтворення: make report-coverage, вихідний коміт ${sha}`,
    "# Команда: npm run test:transitions (c8 --check-coverage --branches 80 --functions 80 vitest run)",
    `# Код виходу: ${transitions.code} (очікувано 0)`,
    "",
    normalize(transitions.output),
    "",
  ].join("\n"),
);

if (src.code !== 0 || transitions.code !== 0) {
  console.error(src.output, transitions.output);
  console.error("coverage: прогін упав");
  process.exit(1);
}
console.log(
  `coverage-src.txt, coverage-transitions.txt: на ${sha.slice(0, 7)}`,
);
