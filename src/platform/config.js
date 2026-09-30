/**
 * Конфіг застосунку зі змінних оточення.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ port: number }}
 */
export function readConfig(env) {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT має бути цілим числом 0–65535, отримано: ${raw}`);
  }
  return { port };
}
