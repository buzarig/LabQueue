// Міграції (ADR-0026): migrations/NNN-назва.sql по порядку, кожна у своїй
// транзакції; весь запуск — під pg_advisory_lock, тож два одночасні запуски
// не застосують одну міграцію двічі. Застосовані — у public.schema_migrations.
// Лише вперед: змінювати застосовану міграцію не можна, тільки нова.
//
//   make db-migrate   (DATABASE_URL з .env або оточення)
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

export const MIGRATIONS = resolve(import.meta.dirname, "../migrations");
const LOCK_KEY = 7_331_001;
const FILE = /^\d{3}-[a-z0-9-]+\.sql$/;

/**
 * Застосовує нові міграції. Повертає імена застосованих зараз.
 * @param {import("postgres").Sql} sql
 * @param {string} [dir]
 * @returns {Promise<string[]>}
 */
export async function migrate(sql, dir = MIGRATIONS) {
  const files = readdirSync(dir)
    .filter((name) => FILE.test(name))
    .sort();
  const conn = await sql.reserve();
  try {
    await conn`select pg_advisory_lock(${LOCK_KEY})`;
    await conn`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`;
    const done = new Set(
      (await conn`select name from public.schema_migrations`).map(
        (row) => row.name,
      ),
    );
    /** @type {string[]} */
    const applied = [];
    for (const name of files) {
      if (done.has(name)) continue;
      const text = readFileSync(join(dir, name), "utf8");
      // Зарезервоване з'єднання не має begin(): транзакція — вручну, щоб
      // advisory lock і міграція йшли тим самим з'єднанням.
      await conn`begin`;
      try {
        await conn.unsafe(text);
        await conn`insert into public.schema_migrations (name) values (${name})`;
        await conn`commit`;
      } catch (error) {
        await conn`rollback`;
        throw error;
      }
      applied.push(name);
    }
    return applied;
  } finally {
    await conn`select pg_advisory_unlock(${LOCK_KEY})`;
    conn.release();
  }
}

if (import.meta.main) {
  const sql = postgres(String(process.env.DATABASE_URL), {
    max: 1,
    onnotice: () => {},
  });
  const applied = await migrate(sql);
  await sql.end();
  console.log(
    applied.length > 0
      ? `db-migrate: застосовано ${applied.join(", ")}`
      : "db-migrate: нових міграцій немає",
  );
}
