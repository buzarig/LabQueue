// Збірка: бандл src/main.js у <outdir>/main.js з вшитим sha (ADR-0012, ADR-0019).
// Sha — з git; без git (збірка образу на Railway) — з RAILWAY_GIT_COMMIT_SHA
// (ADR-0043); інакше "unknown".
// Використання: node scripts/build.js [outdir]   (за замовчуванням dist)
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const SHA = /^[0-9a-f]{40}$/;

/**
 * Sha HEAD; без git — RAILWAY_GIT_COMMIT_SHA, якщо це повний sha; інакше
 * "unknown" (К8 лаби 1: лише sha або unknown).
 * @returns {string}
 */
function buildSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    const fromEnv = process.env.RAILWAY_GIT_COMMIT_SHA ?? "";
    return SHA.test(fromEnv) ? fromEnv : "unknown";
  }
}

const outdir = process.argv[2] ?? "dist";

await build({
  entryPoints: ["src/main.js"],
  outfile: `${outdir}/main.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  define: { "globalThis.__LABQUEUE_SHA__": JSON.stringify(buildSha()) },
  logLevel: "warning",
});
