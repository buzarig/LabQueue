/**
 * М'ютекс за ключем: захоплення одного ключа чекають одне одного по черзі,
 * різні ключі не заважають. Для статики — блокування за викладачем
 * (ADR-0022, ADR-0030) і очікування на ключі ідемпотентності (ADR-0035).
 */
export function createKeyedMutex() {
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map();
  return {
    /**
     * Чекає, доки ключ звільниться, і захоплює його.
     * @param {string} key
     * @returns {Promise<() => void>} звільнення
     */
    async acquire(key) {
      const previous = tails.get(key) ?? Promise.resolve();
      /** @type {() => void} */
      let release = () => {};
      const mine = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const tail = previous.then(() => mine);
      tails.set(key, tail);
      await previous;
      return () => {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      };
    },
  };
}
