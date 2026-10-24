// Seed-дані довідників і користувачів (data.md, «Seed-дані») з тих самих
// seed.json, що вантажить статика. Upsert: повторний запуск нічого не змінює.
//
//   make db-seed   (DATABASE_URL з .env або оточення)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const MODULES = resolve(import.meta.dirname, "../src/modules");

/** @param {string} file */
const json = (file) => JSON.parse(readFileSync(resolve(MODULES, file), "utf8"));

/**
 * @param {import("postgres").Sql} sql
 */
export async function seed(sql) {
  const catalog = json("catalog/seed.json");
  /** @type {Array<{ id: string, name: string, role: string, groupId: string | null }>} */
  const users = json("identity/seed.json");
  await sql.begin(async (tx) => {
    for (const g of catalog.groups) {
      await tx`
        insert into catalog.groups (id, name) values (${g.id}, ${g.name})
        on conflict (id) do update set name = excluded.name`;
    }
    for (const s of catalog.subjects) {
      await tx`
        insert into catalog.subjects (id, name) values (${s.id}, ${s.name})
        on conflict (id) do update set name = excluded.name`;
    }
    for (const l of catalog.labs) {
      await tx`
        insert into catalog.labs (id, subject_id, number, title)
        values (${l.id}, ${l.subjectId}, ${l.number}, ${l.title})
        on conflict (id) do update set subject_id = excluded.subject_id,
          number = excluded.number, title = excluded.title`;
    }
    for (const u of users) {
      await tx`
        insert into identity.users (id, name, role, group_id)
        values (${u.id}, ${u.name}, ${u.role}, ${u.groupId})
        on conflict (id) do update set name = excluded.name,
          role = excluded.role, group_id = excluded.group_id`;
    }
  });
}

if (import.meta.main) {
  const sql = postgres(String(process.env.DATABASE_URL), {
    max: 1,
    onnotice: () => {},
  });
  await seed(sql);
  await sql.end();
  console.log("db-seed: довідники й користувачі оновлено");
}
