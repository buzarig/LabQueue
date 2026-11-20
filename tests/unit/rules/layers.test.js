// Правила шарів падають на навмисних порушеннях (standards/checks.md,
// «Перевірка має доведено падати»): К4 — dependency-cruiser і
// no-restricted-imports, К6 — try/catch поза platform/ і repo-pg.js (ADR-0031).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { ESLint } from "eslint";

const root = resolve(import.meta.dirname, "../../..");
const MODULES = ["identity", "catalog", "sessions", "queue"];

/** @type {string[]} */
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true })));

/**
 * Дерево src/ з правильними шарами в кожному модулі + `extra` поверх.
 * @param {Record<string, string>} extra
 */
function tree(extra = {}) {
  /** @type {Record<string, string>} */
  const files = {
    "src/main.js": MODULES.map((m) => `import "./modules/${m}/index.js";`).join(
      "\n",
    ),
  };
  for (const m of MODULES) {
    Object.assign(files, {
      [`src/modules/${m}/index.js`]:
        'import "./routes.js";\nimport "./repo-memory.js";\n',
      [`src/modules/${m}/routes.js`]:
        'import "./service.js";\nimport "./errors.js";\n',
      [`src/modules/${m}/service.js`]:
        'import "./repo.js";\nimport "./model.js";\nimport "./errors.js";\n',
      [`src/modules/${m}/repo.js`]: 'import "./model.js";\n',
      [`src/modules/${m}/repo-memory.js`]:
        'import "./repo.js";\nimport "./model.js";\n',
      [`src/modules/${m}/model.js`]: "export {};\n",
      [`src/modules/${m}/errors.js`]: "export {};\n",
    });
  }
  Object.assign(files, extra);
  const dir = mkdtempSync(join(tmpdir(), "labqueue-layers-"));
  temps.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

/**
 * Порушення dependency-cruiser у дереві: «правило файл-звідки».
 * @param {string} dir
 * @returns {string[]}
 */
function cruise(dir) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs"),
      "src",
      "--config",
      join(root, ".dependency-cruiser.cjs"),
      "--output-type",
      "json",
    ],
    { cwd: dir, encoding: "utf8" },
  );
  const report = JSON.parse(result.stdout);
  return report.summary.violations.map(
    (/** @type {{ rule: { name: string }, from: string }} */ v) =>
      `${v.rule.name} ${v.from}`,
  );
}

test("dependency-cruiser: правильні шари в усіх модулях — без порушень", () => {
  assert.deepEqual(cruise(tree()), []);
});

test("dependency-cruiser: кожне порушення шарів ловить своє правило", () => {
  const violations = cruise(
    tree({
      "src/modules/queue/routes.js": 'import "./repo-memory.js";\n',
      "src/modules/sessions/service.js": 'import "./routes.js";\n',
      "src/modules/catalog/repo-memory.js": 'import "./service.js";\n',
      "src/modules/identity/model.js": 'import "./errors.js";\n',
      "src/modules/queue/index.js":
        'import "./routes.js";\nimport "./repo-memory.js";\nimport "./helpers.js";\n',
      "src/modules/queue/helpers.js": "export {};\n",
    }),
  );
  for (const expected of [
    "layer-routes src/modules/queue/routes.js",
    "layer-service src/modules/sessions/service.js",
    "layer-repo src/modules/catalog/repo-memory.js",
    "layer-leaf src/modules/identity/model.js",
    "layer-known-roles src/modules/queue/index.js",
  ]) {
    assert.ok(
      violations.includes(expected),
      `немає «${expected}» серед: ${violations.join(", ")}`,
    );
  }
});

const eslint = new ESLint({ cwd: root });

/**
 * Правила ESLint, що спрацювали на коді у файлі з таким шляхом.
 * @param {string} file шлях від кореня
 * @param {string} code
 */
async function lint(file, code) {
  const [result] = await eslint.lintText(code, {
    filePath: join(root, file),
  });
  return result.messages.map((m) => m.ruleId);
}

const TRY = "try {\n  JSON.parse('1');\n} catch {\n  // нічого\n}\n";

test("ESLint: try/catch у сервісі чи роуті — помилка (К6)", async () => {
  assert.ok(
    (await lint("src/modules/queue/service.js", TRY)).includes(
      "no-restricted-syntax",
    ),
  );
  assert.ok(
    (await lint("src/modules/queue/routes.js", TRY)).includes(
      "no-restricted-syntax",
    ),
  );
});

test("ESLint: try/catch у platform/ і repo-pg.js — дозволено", async () => {
  assert.ok(
    !(await lint("src/platform/server.js", TRY)).includes(
      "no-restricted-syntax",
    ),
  );
  assert.ok(
    !(await lint("src/modules/queue/repo-pg.js", TRY)).includes(
      "no-restricted-syntax",
    ),
  );
});

const DRIVER = 'import postgres from "postgres";\nexport { postgres };\n';

test("ESLint: драйвер БД поза repo-pg.js і platform/db — помилка (К4)", async () => {
  assert.ok(
    (await lint("src/modules/queue/service.js", DRIVER)).includes(
      "no-restricted-imports",
    ),
  );
  assert.ok(
    !(await lint("src/modules/queue/repo-pg.js", DRIVER)).includes(
      "no-restricted-imports",
    ),
  );
  assert.ok(
    !(await lint("src/platform/db/pool.js", DRIVER)).includes(
      "no-restricted-imports",
    ),
  );
});

test("ESLint: sql.unsafe заборонено навіть у repo-pg.js (ADR-0032)", async () => {
  const code = "export const q = (sql, s) => sql.unsafe(s);\n";
  assert.ok(
    (await lint("src/modules/queue/repo-pg.js", code)).includes(
      "no-restricted-properties",
    ),
  );
});
