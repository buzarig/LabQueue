/**
 * Конфіг застосунку зі змінних оточення.
 * STORAGE — `pg` (типово) або `memory` (статика, ADR-0027); для `pg`
 * обов'язковий DATABASE_URL.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ port: number, storage: "memory" | "pg", databaseUrl: string | undefined }}
 */
export function readConfig(env) {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT має бути цілим числом 0–65535, отримано: ${raw}`);
  }
  const storage = env.STORAGE ?? "pg";
  if (storage !== "memory" && storage !== "pg") {
    throw new Error(`STORAGE має бути memory або pg, отримано: ${storage}`);
  }
  const databaseUrl = env.DATABASE_URL;
  if (storage === "pg" && !databaseUrl) {
    throw new Error(
      "STORAGE=pg потребує DATABASE_URL (README, «Середовище»), або STORAGE=memory",
    );
  }
  return { port, storage, databaseUrl };
}
