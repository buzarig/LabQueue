// CHK-11 (К10): обхід точки входу, цикл, заборонений напрям і залежність
// домену від fastify (правило 7) валять make check. Кожне порушення — окремо, у чистому тимчасовому клоні.
// Реальний вивід — reports/lab1/boundaries.txt.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, run, withSandbox, writeReport } from "./demo-lib.js";

/**
 * Порушення: файли, які треба дописати (append) або створити (write).
 * Код відформатований і проходить лінт і типи, щоб make check дійшов до меж.
 * @type {Array<{ name: string, rule: string, write?: Record<string, string>, append: Record<string, string> }>}
 */
const VIOLATIONS = [
  {
    name: "Обхід точки входу: queue імпортує внутрішній файл sessions",
    rule: "arch-1-entry-only (правило 1)",
    write: {
      "src/modules/sessions/internal.js": "export const internal = 1;\n",
    },
    append: {
      "src/modules/sessions/index.js":
        'export { internal } from "./internal.js";\n',
      "src/modules/queue/index.js":
        'export { internal as sessionsInternal } from "../sessions/internal.js";\n',
    },
  },
  {
    name: "Цикл: queue/a.js ↔ queue/b.js",
    rule: "arch-2-no-circular (правило 2)",
    write: {
      "src/modules/queue/a.js":
        'export { b } from "./b.js";\nexport const a = 1;\n',
      "src/modules/queue/b.js":
        'export { a } from "./a.js";\nexport const b = 2;\n',
    },
    append: { "src/modules/queue/index.js": 'export { a } from "./a.js";\n' },
  },
  {
    name: "Заборонений напрям: catalog → identity",
    rule: "arch-3-catalog-leaf (правило 3)",
    append: {
      "src/modules/catalog/index.js":
        'export { plugin as identityPlugin } from "../identity/index.js";\n',
    },
  },
  {
    name: "Домен залежить від HTTP: логіка queue імпортує fastify",
    rule: "arch-7-domain-without-http (правило 7, sf-21)",
    write: {
      "src/modules/queue/logic.js":
        'export { default as Fastify } from "fastify";\n',
    },
    append: {
      "src/modules/queue/index.js": 'export { Fastify } from "./logic.js";\n',
    },
  },
];

withSandbox(({ tmp, repo }) => {
  const cases = VIOLATIONS.map((violation) => {
    for (const [file, text] of Object.entries(violation.write ?? {})) {
      writeFileSync(join(repo, file), text);
    }
    for (const [file, text] of Object.entries(violation.append)) {
      appendFileSync(join(repo, file), text);
    }
    const result = run("make", ["check"], repo);
    if (!result.output.includes(violation.rule.split(" ")[0])) {
      throw new Error(`${violation.name}: у виводі немає ${violation.rule}`);
    }
    must("git", ["checkout", "--quiet", "--", "."], repo);
    must("git", ["clean", "-fdq", "src"], repo);
    return {
      name: `${violation.name} — очікуване правило ${violation.rule}`,
      command: "make check",
      result,
    };
  });
  writeReport(
    "boundaries.txt",
    "К10: порушення меж модулів валить make check",
    cases,
    tmp,
  );
});
