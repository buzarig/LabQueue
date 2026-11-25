// Фонові міграції (ADR-0044): дані з migrations/data/ пакетами й індекси з
// migrations/indexes/ через CREATE INDEX CONCURRENTLY поза транзакцією.
// Запускаються в контейнері поруч із HTTP — /ready їх не чекає, тож довгий
// індекс не дає циклу «таймаут health check → рестарт». Структурні міграції
// (scripts/migrate.js, Pre-deploy) мають бути застосовані раніше.
//
// - Журнал — той самий public.schema_migrations, ім'я з текою:
//   data/001-trim-room.sql. Застосований крок не повторюється.
// - Дані: файл — один оператор, що змінює щонайбільше один пакет рядків
//   (limit у підзапиті). Ранер повторює його, доки змінено 0 рядків; кожен
//   пакет — окрема коротка транзакція.
// - Індекси: файл — один `create index concurrently if not exists <ім'я>`.
//   Якщо перерваний запуск лишив невалідний індекс із цим ім'ям, ранер
//   видаляє його (drop index concurrently) і створює знову.
// - Під pg_try_advisory_lock: друга копія (стара й нова версія під час
//   деплою) нічого не робить і не чекає.
//
//   node scripts/migrate-background.js   (DATABASE_URL з оточення)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { MIGRATIONS } from "./migrate.js";

const LOCK_KEY = 7_331_002;
const FILE = /^\d{3}-[a-z0-9-]+\.sql$/;
const KINDS = /** @type {const} */ (["data", "indexes"]);
const INDEX_NAME = /create\s+index\s+concurrently\s+if\s+not\s+exists\s+(\w+)/i;

/** @param {string} dir */
const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => FILE.test(name))
        .sort()
    : [];

/**
 * @param {import("postgres").ReservedSql} conn
 * @param {string} name
 * @param {string} text
 * @param {(line: string) => void} log
 */
async function runData(conn, name, text, log) {
  let total = 0;
  for (let batch = 1; ; batch++) {
    const { count } = await conn.unsafe(text);
    if (count === 0) break;
    total += count;
    log(`migrate-background: ${name} — пакет ${batch}, рядків: ${count}`);
  }
  log(`migrate-background: ${name} — готово, рядків разом: ${total}`);
}

/**
 * @param {import("postgres").ReservedSql} conn
 * @param {string} name
 * @param {string} text
 * @param {(line: string) => void} log
 */
async function runIndex(conn, name, text, log) {
  const index = INDEX_NAME.exec(text)?.[1];
  if (!index) {
    throw new Error(
      `${name}: очікується create index concurrently if not exists <ім'я>`,
    );
  }
  const [invalid] = await conn`
    select n.nspname as schema from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = ${index} and not i.indisvalid`;
  if (invalid) {
    await conn`drop index concurrently ${conn(invalid.schema)}.${conn(index)}`;
    log(`migrate-background: ${name} — невалідний ${index} видалено`);
  }
  const started = Date.now();
  await conn.unsafe(text);
  log(
    `migrate-background: ${name} — індекс ${index} за ${((Date.now() - started) / 1000).toFixed(1)} с`,
  );
}

/**
 * Застосовує нові фонові міграції. Повертає імена застосованих зараз; якщо
 * інша копія вже працює — порожній список.
 * @param {import("postgres").Sql} sql
 * @param {{ dir?: string, log?: (line: string) => void }} [opts]
 * @returns {Promise<string[]>}
 */
export async function migrateBackground(
  sql,
  { dir = MIGRATIONS, log = console.log } = {},
) {
  const conn = await sql.reserve();
  try {
    const [{ locked }] =
      await conn`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!locked) {
      log("migrate-background: інша копія вже виконує фонові міграції");
      return [];
    }
    try {
      const done = new Set(
        (await conn`select name from public.schema_migrations`).map(
          (row) => row.name,
        ),
      );
      /** @type {string[]} */
      const applied = [];
      for (const kind of KINDS) {
        for (const file of files(join(dir, kind))) {
          const name = `${kind}/${file}`;
          if (done.has(name)) continue;
          const text = readFileSync(join(dir, kind, file), "utf8");
          if (kind === "data") await runData(conn, name, text, log);
          else await runIndex(conn, name, text, log);
          await conn`insert into public.schema_migrations (name) values (${name})`;
          applied.push(name);
        }
      }
      return applied;
    } finally {
      await conn`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    conn.release();
  }
}

if (import.meta.main) {
  const sql = postgres(String(process.env.DATABASE_URL), {
    max: 1,
    onnotice: () => {},
  });
  try {
    const applied = await migrateBackground(sql);
    if (applied.length === 0) {
      console.log("migrate-background: нових фонових міграцій немає");
    }
  } finally {
    await sql.end();
  }
}
