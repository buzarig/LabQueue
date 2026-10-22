// Проба JSDoc для ADR-0020: кожен рядок з міткою ERR має рівно одну помилку
// типу, інших помилок немає. Файл виключено з основного tsconfig.json.
import { readFileSync } from "node:fs";

/** @typedef {"очікує" | "викликаний" | "здає" | "зараховано"} Status */
/** @typedef {{ id: string, status: Status, score?: number }} Entry */

/** @type {Status} */
export const bad = "невідомий"; // ERR union рядкових літералів

/**
 * @param {Entry} e
 * @returns {number}
 */
export function score(e) {
  return e.score; // ERR необов'язкове поле під strict
}

/**
 * @template T
 * @param {T[]} xs
 * @returns {T}
 */
function first(xs) {
  return xs[0];
}
/** @type {string} */
export const n = first([1, 2]); // ERR @template

/**
 * @callback Check
 * @param {Entry} e
 * @returns {boolean}
 */
/** @type {Check} */
export const check = (e) => e.id; // ERR @callback

/** @param {NodeJS.ProcessEnv} env */
export function port(env) {
  return env.PORT.length; // ERR @types/node
}

/** @type {number} */
export const cast = /** @type {string} */ ("x"); // ERR JSDoc-каст

/** @type {import("node:http").Server | null} */
export const srv = 42; // ERR тип через import()

export const text = readFileSync(123, { encoding: "nope" }); // ERR node:fs
