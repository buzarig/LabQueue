/**
 * Sha коміту, вшитий збіркою через esbuild `define` (ADR-0019).
 * Без збірки (запуск src/ напряму) або без git під час збірки — "unknown".
 * @returns {string}
 */
export function buildSha() {
  const sha = /** @type {any} */ (globalThis).__LABQUEUE_SHA__;
  return typeof sha === "string" && sha.length > 0 ? sha : "unknown";
}
