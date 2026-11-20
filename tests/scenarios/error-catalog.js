// Каталог помилок із data.md — джерело кодів і статусів для К8. Сюїта
// звіряє з ним свої випадки, тож новий код без тесту валить make check.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_MD = resolve(
  import.meta.dirname,
  "../../docs/specs/lab2-db-scenarios/data.md",
);

/**
 * Рядки таблиці «Каталог помилок»: `| CODE[ / CODE] | HTTP | умова | сценарії |`.
 * @param {string} [markdown]
 * @returns {Map<string, number>} код → HTTP-статус
 */
export function parseErrorCatalog(markdown = readFileSync(DATA_MD, "utf8")) {
  const section = markdown.split(/^## Каталог помилок$/m)[1]?.split(/^## /m)[0];
  if (!section) throw new Error("у data.md немає розділу «Каталог помилок»");
  /** @type {Map<string, number>} */
  const catalog = new Map();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const status = Number(cells[2]);
    if (!/^[A-Z_ /]+$/.test(cells[1] ?? "") || !Number.isInteger(status))
      continue;
    for (const code of cells[1].split("/").map((c) => c.trim())) {
      catalog.set(code, status);
    }
  }
  return catalog;
}

/**
 * Коди каталогу без сценарного тесту й без обґрунтованого винятку.
 * @param {Map<string, number>} catalog
 * @param {Iterable<string>} tested
 * @param {Iterable<string>} exempt
 */
export function uncoveredCodes(catalog, tested, exempt) {
  const covered = new Set([...tested, ...exempt]);
  return [...catalog.keys()].filter((code) => !covered.has(code));
}
