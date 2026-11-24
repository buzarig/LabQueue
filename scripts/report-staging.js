// Доказ staging (spec лаби 4, критерії 4, 5, 11): публічні /health, /ready,
// /version, GET /sessions від користувача з seed; sha з /version має
// збігатися з вершиною origin/main, а CI на цьому коміті — бути зеленим.
// Пише reports/<лаба>/staging.txt. Падає, якщо щось не так.
//
//   make report-staging   (потрібні мережа і gh)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, reports, root } from "./demo-lib.js";

/** Публічний домен staging (README, «Staging»). Не секрет. */
export const STAGING_URL =
  "https://labqueue-production-405b3fa1.up.railway.app";

/**
 * @param {string} path
 * @param {Record<string, string>} [headers]
 */
async function get(path, headers = {}) {
  const response = await fetch(`${STAGING_URL}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.text() };
}

must("git", ["fetch", "-q", "origin", "main"], root);
const main = must("git", ["rev-parse", "origin/main"], root).trim();
const repo = must(
  "gh",
  ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
  root,
).trim();
/** @type {{ check_suites: Array<{ app: { slug: string }, conclusion: string | null }> }} */
const suites = JSON.parse(
  must("gh", ["api", `repos/${repo}/commits/${main}/check-suites`], root),
);
const ci =
  suites.check_suites.find((s) => s.app.slug === "github-actions")
    ?.conclusion ?? "немає";

const health = await get("/health");
const ready = await get("/ready");
const version = await get("/version");
const sessions = await get("/sessions", { "x-user-id": "s-1" });
const sha = JSON.parse(version.body).sha;

/** @type {string[]} */
const problems = [];
if (health.status !== 200) problems.push(`/health ${health.status}`);
if (ready.status !== 200) problems.push(`/ready ${ready.status}`);
if (sha !== main) problems.push(`/version ${sha} ≠ origin/main ${main}`);
if (ci !== "success") problems.push(`CI на ${main}: ${ci}`);
if (sessions.status !== 200) problems.push(`GET /sessions ${sessions.status}`);

const text = [
  "# К4, К5, К11 лаби 4: staging на Railway — публічний доступ, версія з main, seed",
  "# Відтворення: make report-staging",
  `# Staging: ${STAGING_URL}`,
  "",
  `origin/main:          ${main}`,
  `CI (GitHub Actions):  ${ci}`,
  `GET /health:          ${health.status} ${health.body}`,
  `GET /ready:           ${ready.status} ${ready.body}`,
  `GET /version:         ${version.status} ${version.body}`,
  `GET /sessions (s-1):  ${sessions.status} (користувач із seed, критерій 11)`,
  `/version = main:      ${sha === main ? "так" : "НІ"}`,
  "",
].join("\n");
mkdirSync(reports, { recursive: true });
writeFileSync(join(reports, "staging.txt"), text);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `staging.txt: /version = origin/main ${main.slice(0, 7)}, CI ${ci}`,
);
