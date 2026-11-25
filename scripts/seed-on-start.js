// Seed перед запуском HTTP на staging (spec лаби 4, критерій 11; ADR-0044):
// лише з SEED_ON_START=1, типово нічого не робить. Окремий крок від міграцій.
// Upsert (scripts/seed.js): повторний запуск не дублює записи.
//
//   SEED_ON_START=1 node scripts/seed-on-start.js && node dist/main.js
import postgres from "postgres";
import { seed } from "./seed.js";

if (process.env.SEED_ON_START === "1") {
  const sql = postgres(String(process.env.DATABASE_URL), {
    max: 1,
    onnotice: () => {},
  });
  try {
    await seed(sql);
  } finally {
    await sql.end();
  }
  console.log("seed-on-start: довідники й користувачі оновлено");
} else {
  console.log("seed-on-start: вимкнено (SEED_ON_START не 1)");
}
