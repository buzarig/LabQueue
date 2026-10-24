// CHK-07 у commit-msg: файл промпту з трейлера має бути в самому коміті
// (в індексі), а не лише на диску (docs/audit/lab2.md, кандидат 2).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const script = resolve(
  import.meta.dirname,
  "../../../scripts/check-commits.js",
);
const repo = mkdtempSync(join(tmpdir(), "labqueue-commit-msg-"));
after(() => rmSync(repo, { recursive: true }));

execFileSync("git", ["init", "-q"], { cwd: repo });
mkdirSync(join(repo, "ai/lab2"), { recursive: true });
writeFileSync(join(repo, "ai/lab2/001-test.md"), "промпт\n");
writeFileSync(
  join(repo, "msg.txt"),
  [
    "docs: перевірка трейлера",
    "",
    "Prompt: ai/lab2/001-test.md",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "",
  ].join("\n"),
);

const check = () =>
  spawnSync(process.execPath, [script, "--msg-file", "msg.txt"], {
    cwd: repo,
    encoding: "utf8",
  });

test("файл промпту лише на диску, не в коміті → commit-msg відхиляє", () => {
  const result = check();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /файлу промпту немає в коміті: ai\/lab2\/001-test\.md/,
  );
});

test("файл промпту доданий у коміт (git add) → commit-msg пропускає", () => {
  execFileSync("git", ["add", "ai/lab2/001-test.md"], { cwd: repo });
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});
