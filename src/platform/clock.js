/**
 * Годинник, який main.js передає модулям; тести підставляють керований
 * (data.md, «Ідентичність і загальні правила HTTP»).
 * @typedef {{ now: () => Date }} Clock
 */

/** @type {Clock} */
export const systemClock = { now: () => new Date() };
