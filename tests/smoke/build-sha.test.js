// Sha збірки без git (ADR-0043): Railway збирає образ без .git і передає sha
// змінною RAILWAY_GIT_COMMIT_SHA. Git вимикаємо через GIT_DIR, що веде в
// порожню теку, і дивимось, яке значення збірка вшила в main.js.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const tmp = mkdtempSync(join(tmpdir(), "labqueue-build-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Збирає в окрему теку без git і повертає вміст бандла.
 * @param {string} name
 * @param {Record<string, string>} env
 */
function buildWithoutGit(name, env) {
  const outdir = join(tmp, name);
  /** @type {Record<string, string | undefined>} */
  const base = { ...process.env, GIT_DIR: join(tmp, "no-git") };
  delete base.RAILWAY_GIT_COMMIT_SHA;
  execFileSync(process.execPath, ["scripts/build.js", outdir], {
    env: { ...base, ...env },
    stdio: "ignore",
  });
  return readFileSync(join(outdir, "main.js"), "utf8");
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("без git: sha з RAILWAY_GIT_COMMIT_SHA", () => {
  assert.ok(
    buildWithoutGit("env", { RAILWAY_GIT_COMMIT_SHA: SHA }).includes(
      `"${SHA}"`,
    ),
  );
});

test("без git і без змінної — unknown", () => {
  assert.ok(buildWithoutGit("none", {}).includes('"unknown"'));
});

test("без git і не sha у змінній — unknown, а не будь-який рядок", () => {
  const bundle = buildWithoutGit("bad", {
    RAILWAY_GIT_COMMIT_SHA: "not-a-sha-value",
  });
  assert.ok(bundle.includes('"unknown"'));
  assert.ok(!bundle.includes("not-a-sha-value"));
});
