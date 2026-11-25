// Машина станів запису черги (ADR-0037; architecture.md, «Стани» →
// QueueEntry): S4–S8, S12. Чисті функції без I/O — час, seq і лічильник
// неявок приходять параметрами. Перехід повертає зміну полів запису або
// кидає помилку з errors.js; зберігає зміну сервіс.
import {
  entryStateConflict,
  scoreMismatch,
  sessionStateConflict,
  submittingInProgress,
} from "./errors.js";

/** @typedef {import("./model.js").Entry} Entry */
/** @typedef {import("./model.js").EntryStatus} EntryStatus */
/** @typedef {import("./model.js").Result} Result */

/** Друга неявка — «вибув» (I7, ADR-0003). */
export const MAX_NO_SHOWS = 2;

/**
 * Дозволені переходи: зі стану → у стани. passed, rework, left, dropped,
 * missed — кінцеві.
 * @type {Readonly<Record<EntryStatus, readonly EntryStatus[]>>}
 */
const NEXT = {
  waiting: ["called", "left", "missed"],
  called: ["submitting", "waiting", "dropped", "missed"],
  submitting: ["passed", "rework"],
  passed: [],
  rework: [],
  left: [],
  dropped: [],
  missed: [],
};

/**
 * @param {EntryStatus} from
 * @param {EntryStatus} to
 */
export function canTransition(from, to) {
  return NEXT[from].includes(to);
}

/**
 * Перехід недозволений → 409 ENTRY_STATE_CONFLICT.
 * @param {Entry} entry
 * @param {EntryStatus} to
 */
export function assertTransition(entry, to) {
  if (!canTransition(entry.status, to)) {
    throw entryStateConflict(entry.status, to);
  }
}

/**
 * S5. Виклик: waiting → called.
 * @param {Entry} entry
 * @param {string} at
 * @returns {Partial<Entry>}
 */
export function call(entry, at) {
  assertTransition(entry, "called");
  return { status: "called", calledAt: at };
}

/**
 * S6. Почати прийом: called → submitting (sf-17).
 * @param {Entry} entry
 * @param {string} at
 * @returns {Partial<Entry>}
 */
export function start(entry, at) {
  assertTransition(entry, "submitting");
  return { status: "submitting", startedAt: at };
}

/**
 * S7. Результат: submitting → passed (з балом) | rework (без балу), I9.
 * Спершу стан, потім бал — як і до ADR-0037.
 * @param {Entry} entry
 * @param {Result} result
 * @param {string} at
 * @returns {Partial<Entry>}
 */
export function result(entry, { outcome, score }, at) {
  assertTransition(entry, outcome);
  if (outcome === "passed" && score === undefined) {
    throw scoreMismatch("«Зараховано» вимагає бал 0–100");
  }
  if (outcome === "rework" && score !== undefined) {
    throw scoreMismatch("«На доопрацювання» без балу");
  }
  return {
    status: outcome,
    score: outcome === "passed" ? /** @type {number} */ (score) : null,
    finishedAt: at,
  };
}

/**
 * S8. Неявку можна позначити лише з called (sf-8). Перевіряється до того,
 * як лічильник неявок збільшиться.
 * @param {Entry} entry
 */
export function assertNoShow(entry) {
  assertTransition(entry, "waiting");
}

/**
 * S8. Лічильник неявок пари (студент, заняття) уже з цією неявкою: друга —
 * «вибув».
 * @param {number} noShowCount
 */
export function isDropped(noShowCount) {
  return noShowCount >= MAX_NO_SHOWS;
}

/**
 * S8, друга неявка: called → dropped.
 * @param {Entry} entry
 * @param {string} at
 * @returns {Partial<Entry>}
 */
export function drop(entry, at) {
  assertTransition(entry, "dropped");
  return { status: "dropped", finishedAt: at };
}

/**
 * S8, перша неявка: called → waiting у кінець черги (новий seq, ADR-0001).
 * @param {Entry} entry
 * @param {number} seq
 * @returns {Partial<Entry>}
 */
export function requeue(entry, seq) {
  assertTransition(entry, "waiting");
  return { status: "waiting", seq };
}

/**
 * S12. Вихід студента: waiting → left (sf-13). Лічильник неявок не
 * змінюється.
 * @param {Entry} entry
 * @param {string} at
 * @returns {Partial<Entry>}
 */
export function leave(entry, at) {
  assertTransition(entry, "left");
  return { status: "left", finishedAt: at };
}

/**
 * S4. Завершити заняття можна лише з closed (ADR-0005).
 * @param {string} sessionState
 */
export function assertFinishable(sessionState) {
  if (sessionState !== "closed") {
    throw sessionStateConflict(sessionState, "finished");
  }
}

/**
 * S4. Поки хтось здає, заняття не завершується (I10, sf-18).
 * @param {boolean} hasSubmitting
 */
export function assertNoSubmitting(hasSubmitting) {
  if (hasSubmitting) throw submittingInProgress();
}

/**
 * S4. Статуси, з яких запис стає missed на завершенні заняття: waiting і
 * called. Виводяться з таблиці переходів, а не задаються вдруге.
 * @type {readonly EntryStatus[]}
 */
export const MISSED_ON_FINISH = /** @type {EntryStatus[]} */ (
  Object.keys(NEXT)
).filter((from) => canTransition(from, "missed"));
