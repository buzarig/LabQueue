// Локальний кластер PostgreSQL 17 у .pgdata/ на 127.0.0.1:55432 (ADR-0033).
// make db-up | db-down | db-destroy. Роль, пароль і БД бере з DATABASE_URL
// (.env або оточення), пароль не виводить.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PORT = 55432;
const root = join(import.meta.dirname, "..");
const base = join(root, ".pgdata");
const data = join(base, "data");
const BIN_CANDIDATES = [
  "/opt/homebrew/opt/postgresql@17/bin",
  "/usr/local/opt/postgresql@17/bin",
  "/usr/lib/postgresql/17/bin",
];

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`db: ${message}`);
  process.exit(1);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ input?: string, env?: NodeJS.ProcessEnv }} [options]
 */
function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
  });
}

/** Каталог бінарників PostgreSQL 17: PG_BIN або типові шляхи. */
function pgBin() {
  const dirs = process.env.PG_BIN ? [process.env.PG_BIN] : BIN_CANDIDATES;
  const dir = dirs.find((d) => existsSync(join(d, "pg_ctl")));
  if (!dir) {
    fail(
      "не знайдено PostgreSQL 17: brew install postgresql@17 або PG_BIN=<каталог bin>",
    );
  }
  const version = run(join(dir, "postgres"), ["--version"]).stdout;
  if (!/ 17\./.test(version)) {
    fail(`потрібен PostgreSQL 17, у ${dir}: ${version.trim()}`);
  }
  return dir;
}

/** Роль, пароль і БД з DATABASE_URL; хост і порт мають бути кластером. */
function target() {
  const envFile = join(root, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("немає DATABASE_URL: cp .env.example .env і вкажіть пароль");
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    fail(`DATABASE_URL має вказувати на 127.0.0.1:${PORT}, а не ${url.host}`);
  }
  if (Number(url.port) !== PORT) {
    fail(`DATABASE_URL має порт ${url.port || "5432"}, а кластер — ${PORT}`);
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const db = url.pathname.slice(1);
  if (!user || !password || !db) {
    fail("DATABASE_URL має містити роль, пароль і назву БД");
  }
  if (password === "CHANGE_ME") fail("замініть CHANGE_ME у .env паролем");
  return { user, password, db };
}

/** @param {string} bin */
function running(bin) {
  return run(join(bin, "pg_ctl"), ["status", "-D", data]).status === 0;
}

// Роль і БД створюються, якщо їх немає; пароль оновлюється щоразу.
// CREATEDB — для окремої БД на кожен прогін тестів (ADR-0033).
const SETUP_SQL = String.raw`
\set ON_ERROR_STOP on
\getenv lq_user LQ_USER
\getenv lq_password LQ_PASSWORD
\getenv lq_db LQ_DB
select format('create role %I', :'lq_user')
  where not exists (select from pg_roles where rolname = :'lq_user') \gexec
alter role :"lq_user" with login createdb nosuperuser password :'lq_password';
select format('create database %I owner %I', :'lq_db', :'lq_user')
  where not exists (select from pg_database where datname = :'lq_db') \gexec
`;

function up() {
  const bin = pgBin();
  const { user, password, db } = target();
  if (!existsSync(data)) {
    const init = run(join(bin, "initdb"), [
      "-D",
      data,
      "-U",
      "postgres",
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      "--encoding=UTF8",
      "--no-locale",
    ]);
    if (init.status !== 0) fail(`initdb:\n${init.stderr}`);
    console.log(`db: кластер створено в ${data}`);
  }
  if (!running(bin)) {
    const opts = `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories='${base}'`;
    const start = run(join(bin, "pg_ctl"), [
      "start",
      "-D",
      data,
      "-l",
      join(base, "server.log"),
      "-w",
      "-o",
      opts,
    ]);
    if (start.status !== 0) {
      fail(`pg_ctl start (лог — .pgdata/server.log):\n${start.stderr}`);
    }
  }
  const setup = run(
    join(bin, "psql"),
    ["-X", "-q", "-h", base, "-p", String(PORT), "-U", "postgres", "postgres"],
    {
      input: SETUP_SQL,
      env: { LQ_USER: user, LQ_PASSWORD: password, LQ_DB: db },
    },
  );
  if (setup.status !== 0) fail(`роль і БД:\n${setup.stderr}`);
  console.log(`db: PostgreSQL 17 на 127.0.0.1:${PORT}, роль ${user}, БД ${db}`);
}

function down() {
  const bin = pgBin();
  if (!existsSync(data) || !running(bin)) {
    console.log("db: кластер не запущений");
    return;
  }
  const stop = run(join(bin, "pg_ctl"), ["stop", "-D", data, "-m", "fast"]);
  if (stop.status !== 0) fail(`pg_ctl stop:\n${stop.stderr}`);
  console.log("db: кластер зупинено");
}

function destroy() {
  down();
  rmSync(base, { recursive: true, force: true });
  console.log("db: .pgdata/ видалено");
}

/** @type {Record<string, () => void>} */
const commands = { up, down, destroy };
const command = commands[process.argv[2] ?? ""];
if (!command) fail("використання: node scripts/db.js up|down|destroy");
command();
