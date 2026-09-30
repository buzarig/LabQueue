// CHK-11 (К7): коміт з порушенням стилю й пуш зі зламаним smoke-тестом
// відхиляються hook-ами. Реальний вивід — reports/lab1/hook-*.txt.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { must, run, withSandbox, writeReport } from "./demo-lib.js";

withSandbox(({ tmp, repo }) => {
  // Демо 1: коміт з порушенням стилю → pre-commit (lint-staged) відхиляє.
  const bad = "src/platform/demo-bad-style.js";
  writeFileSync(join(repo, bad), "export const demo = {a:1}\n");
  must("git", ["add", bad], repo);
  const message = "chore: демо коміту з порушенням стилю";
  writeReport(
    "hook-pre-commit.txt",
    "К7: коміт з порушенням стилю відхиляється pre-commit",
    [
      {
        name: "pre-commit",
        command: `git commit -m "${message}"`,
        result: run("git", ["commit", "-m", message], repo),
      },
    ],
    tmp,
  );
  must("git", ["rm", "--quiet", "--cached", bad], repo);
  rmSync(join(repo, bad));

  // Демо 2: пуш зі зламаним smoke-тестом → pre-push (make check) відхиляє.
  const server = join(repo, "src/platform/server.js");
  const source = readFileSync(server, "utf8");
  const broken = source.replace('({ status: "ok" })', '({ status: "broken" })');
  if (broken === source) throw new Error("не знайшов відповідь /health");
  writeFileSync(server, broken);
  must("git", ["commit", "--quiet", "-am", "test: демо зламаного smoke"], repo);
  must("git", ["init", "--quiet", "--bare", join(tmp, "remote.git")], tmp);
  must("git", ["remote", "add", "demo", join(tmp, "remote.git")], repo);
  writeReport(
    "hook-pre-push.txt",
    "К7: пуш зі зламаним smoke-тестом відхиляється pre-push",
    [
      {
        name: "pre-push",
        command: "git push demo HEAD",
        result: run("git", ["push", "demo", "HEAD"], repo),
      },
    ],
    tmp,
  );
});
