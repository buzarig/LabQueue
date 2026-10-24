// БД для тестів (ADR-0033): окрема база на кожен прогін — копія шаблону
// labqueue_tmpl, до якого застосовано міграції й seed. Після прогону база
// видаляється. Роль і пароль — з DATABASE_URL (.env або оточення).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { migrate } from "../../scripts/migrate.js";
import { seed } from "../../scripts/seed.js";

const TEMPLATE = "labqueue_tmpl";
const LOCK_KEY = 7_331_002;
const noop = () => {};

/** URL з іншою базою, на тому ж сервері й під тією ж роллю. */
function urlFor(/** @type {string} */ database) {
  const envFile = resolve(import.meta.dirname, "../../.env");
  if (!process.env.DATABASE_URL && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "немає DATABASE_URL: cp .env.example .env і make db-up (README, «Середовище»)",
    );
  }
  const url = new URL(raw);
  url.pathname = `/${database}`;
  return url;
}

/**
 * Підключення до службової бази postgres; без сервера — зрозуміла підказка.
 * @returns {Promise<import("postgres").Sql>}
 */
async function admin() {
  const url = urlFor("postgres");
  const sql = postgres(url.href, {
    max: 1,
    onnotice: noop,
    connect_timeout: 2,
  });
  try {
    await sql`select 1`;
  } catch (error) {
    await sql.end({ timeout: 0 });
    const reason =
      /** @type {{ code?: string }} */ (error).code ?? String(error);
    throw new Error(
      `PostgreSQL на ${url.host} недоступний (${reason}): запустіть make db-up і перевірте .env (README, «Середовище»)`,
      { cause: error },
    );
  }
  return sql;
}

/** @param {import("postgres").Sql} root */
async function ensureTemplate(root) {
  const [found] =
    await root`select 1 as ok from pg_database where datname = ${TEMPLATE}`;
  if (!found) await root`create database ${root(TEMPLATE)}`;
  const template = postgres(urlFor(TEMPLATE).href, { max: 1, onnotice: noop });
  try {
    await migrate(template);
    await seed(template);
  } finally {
    await template.end();
  }
}

/**
 * Нова база для прогону. `empty: true` — без міграцій (тести самого ранера).
 * @param {{ empty?: boolean }} [opts]
 */
export async function createTestDb({ empty = false } = {}) {
  const root = await admin();
  const name = `labqueue_t_${process.pid}_${Date.now().toString(36)}`;
  try {
    await root`select pg_advisory_lock(${LOCK_KEY})`;
    if (empty) {
      await root`create database ${root(name)}`;
    } else {
      await ensureTemplate(root);
      await root`create database ${root(name)} template ${root(TEMPLATE)}`;
    }
    await root`select pg_advisory_unlock(${LOCK_KEY})`;
  } catch (error) {
    // Без цього відкрите з'єднання тримає процес тестів живим.
    await root.end({ timeout: 0 });
    throw error;
  }
  return {
    url: urlFor(name).href,
    /** Підключення до бази прогону. */
    connect: () => postgres(urlFor(name).href, { max: 4, onnotice: noop }),
    async drop() {
      await root`drop database if exists ${root(name)} with (force)`;
      await root.end();
    },
  };
}
