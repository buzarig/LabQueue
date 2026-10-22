// Збірка: бандл src/main.js у <outdir>/main.js з вшитим sha (ADR-0012, ADR-0019).
// Використання: node scripts/build.js [outdir]   (за замовчуванням dist)
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

/**
 * Sha HEAD або "unknown", якщо git недоступний.
 * @returns {string}
 */
function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
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
  define: { "globalThis.__LABQUEUE_SHA__": JSON.stringify(gitSha()) },
  logLevel: "warning",
});
