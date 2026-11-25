// Unit-тести машини станів запису (ADR-0037; spec лаби 3, критерії 4–6).
// Модуль чистий: жодних репозиторіїв, часу чи контексту — лише вхід і вихід.
import { describe, expect, test } from "vitest";
import {
  MAX_NO_SHOWS,
  MISSED_ON_FINISH,
  assertFinishable,
  assertNoShow,
  assertNoSubmitting,
  assertTransition,
  call,
  canTransition,
  drop,
  isDropped,
  leave,
  requeue,
  result,
  start,
} from "../../src/modules/queue/transitions.js";

/** @typedef {import("../../src/modules/queue/model.js").Entry} Entry */
/** @typedef {import("../../src/modules/queue/model.js").EntryStatus} EntryStatus */

/** @type {EntryStatus[]} */
const STATUSES = [
  "waiting",
  "called",
  "submitting",
  "passed",
  "rework",
  "left",
  "dropped",
  "missed",
];

/**
 * Діаграма «Стани» → QueueEntry з architecture.md лаби 1: 9 стрілок між
 * станами. Десята, [*] → waiting, — створення запису (S10), не перехід.
 */
const ALLOWED = new Set([
  "waiting→called",
  "waiting→left",
  "waiting→missed",
  "called→submitting",
  "called→waiting",
  "called→dropped",
  "called→missed",
  "submitting→passed",
  "submitting→rework",
]);

const AT = "2026-11-18T10:00:00.000Z";

/**
 * Заморожений запис: перехід не має права змінювати вхід.
 * @param {EntryStatus} status
 * @returns {Entry}
 */
function entry(status) {
  return Object.freeze({
    id: "e1",
    sessionId: "s1",
    teacherId: "t1",
    studentId: "u1",
    labId: "l1",
    status,
    seq: 3,
    enqueuedAt: "2026-11-18T09:00:00.000Z",
    calledAt: null,
    startedAt: null,
    finishedAt: null,
    score: null,
  });
}

/**
 * Помилка, яку кинула функція; якщо не кинула — тест падає.
 * @param {() => unknown} fn
 */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("очікували помилку, а функція повернула значення");
}

/**
 * @param {string} from
 * @param {string} to
 */
const conflict = (from, to) => ({
  code: "ENTRY_STATE_CONFLICT",
  statusCode: 409,
  message: `Запис не можна перевести зі стану ${from} у ${to}`,
});

/** @param {EntryStatus} from */
const others = (from) => STATUSES.filter((s) => s !== from);

describe("таблиця переходів", () => {
  const pairs = STATUSES.flatMap((from) =>
    STATUSES.map((to) => /** @type {const} */ ([from, to])),
  );

  test.each(pairs)("%s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED.has(`${from}→${to}`));
  });

  test("дозволених пар рівно 9, кінцеві стани нікуди не ведуть", () => {
    expect(pairs.filter(([f, t]) => canTransition(f, t))).toHaveLength(9);
    for (const end of ["passed", "rework", "left", "dropped", "missed"]) {
      for (const to of STATUSES) {
        expect(canTransition(/** @type {EntryStatus} */ (end), to)).toBe(false);
      }
    }
  });

  test("assertTransition: дозволений — без помилки, інакше 409 з обома станами", () => {
    expect(() => assertTransition(entry("waiting"), "called")).not.toThrow();
    expect(thrown(() => assertTransition(entry("passed"), "called"))).toEqual(
      expect.objectContaining(conflict("passed", "called")),
    );
  });
});

describe("S5: виклик", () => {
  test("waiting → called з часом виклику", () => {
    expect(call(entry("waiting"), AT)).toStrictEqual({
      status: "called",
      calledAt: AT,
    });
  });

  test.each(others("waiting"))(
    "з %s — конфлікт, зокрема повторний виклик викликаного",
    (from) => {
      expect(thrown(() => call(entry(from), AT))).toEqual(
        expect.objectContaining(conflict(from, "called")),
      );
    },
  );
});

describe("S6: почати прийом", () => {
  test("called → submitting з часом початку", () => {
    expect(start(entry("called"), AT)).toStrictEqual({
      status: "submitting",
      startedAt: AT,
    });
  });

  test.each(others("called"))(
    "з %s — конфлікт, зокрема повторний старт",
    (from) => {
      expect(thrown(() => start(entry(from), AT))).toEqual(
        expect.objectContaining(conflict(from, "submitting")),
      );
    },
  );
});

describe("S7: результат (I9)", () => {
  test("passed з балом — бал і час завершення", () => {
    expect(
      result(entry("submitting"), { outcome: "passed", score: 87 }, AT),
    ).toStrictEqual({ status: "passed", score: 87, finishedAt: AT });
  });

  test("passed з балом 0 — 0 теж бал, а не його відсутність", () => {
    expect(
      result(entry("submitting"), { outcome: "passed", score: 0 }, AT),
    ).toStrictEqual({ status: "passed", score: 0, finishedAt: AT });
  });

  test("rework без балу — score null", () => {
    expect(
      result(entry("submitting"), { outcome: "rework" }, AT),
    ).toStrictEqual({ status: "rework", score: null, finishedAt: AT });
  });

  test("passed без балу — 422 SCORE_MISMATCH", () => {
    expect(
      thrown(() => result(entry("submitting"), { outcome: "passed" }, AT)),
    ).toEqual(
      expect.objectContaining({
        code: "SCORE_MISMATCH",
        statusCode: 422,
        message: "«Зараховано» вимагає бал 0–100",
      }),
    );
  });

  test.each([0, 50])("rework з балом %i — 422 SCORE_MISMATCH", (score) => {
    expect(
      thrown(() =>
        result(entry("submitting"), { outcome: "rework", score }, AT),
      ),
    ).toEqual(
      expect.objectContaining({
        code: "SCORE_MISMATCH",
        statusCode: 422,
        message: "«На доопрацювання» без балу",
      }),
    );
  });

  test.each(others("submitting"))(
    "з %s — конфлікт стану раніше за перевірку балу",
    (from) => {
      expect(
        thrown(() => result(entry(from), { outcome: "passed" }, AT)),
      ).toEqual(expect.objectContaining(conflict(from, "passed")));
      expect(
        thrown(() => result(entry(from), { outcome: "rework", score: 1 }, AT)),
      ).toEqual(expect.objectContaining(conflict(from, "rework")));
    },
  );
});

describe("S8: неявка (I7, ADR-0003)", () => {
  test("друга неявка — вибув, перша — ні", () => {
    expect(MAX_NO_SHOWS).toBe(2);
    expect(isDropped(0)).toBe(false);
    expect(isDropped(1)).toBe(false);
    expect(isDropped(2)).toBe(true);
    expect(isDropped(3)).toBe(true);
  });

  test("неявку можна позначити лише з called", () => {
    expect(() => assertNoShow(entry("called"))).not.toThrow();
  });

  test.each(others("called"))(
    "неявка з %s — конфлікт у waiting, зокрема повторна неявка",
    (from) => {
      expect(thrown(() => assertNoShow(entry(from)))).toEqual(
        expect.objectContaining(conflict(from, "waiting")),
      );
    },
  );

  test("перша неявка: called → waiting з новим seq, без часу завершення", () => {
    expect(requeue(entry("called"), 9)).toStrictEqual({
      status: "waiting",
      seq: 9,
    });
  });

  test("друга неявка: called → dropped з часом завершення", () => {
    expect(drop(entry("called"), AT)).toStrictEqual({
      status: "dropped",
      finishedAt: AT,
    });
  });

  test.each(others("called"))("requeue і drop з %s — конфлікт", (from) => {
    expect(thrown(() => requeue(entry(from), 9))).toEqual(
      expect.objectContaining(conflict(from, "waiting")),
    );
    expect(thrown(() => drop(entry(from), AT))).toEqual(
      expect.objectContaining(conflict(from, "dropped")),
    );
  });
});

describe("S12: вихід із черги", () => {
  test("waiting → left з часом завершення", () => {
    expect(leave(entry("waiting"), AT)).toStrictEqual({
      status: "left",
      finishedAt: AT,
    });
  });

  test.each(others("waiting"))(
    "з %s — конфлікт, зокрема повторний вихід",
    (from) => {
      expect(thrown(() => leave(entry(from), AT))).toEqual(
        expect.objectContaining(conflict(from, "left")),
      );
    },
  );
});

describe("S4: завершення заняття (ADR-0005, I10)", () => {
  test("завершити можна лише closed", () => {
    expect(() => assertFinishable("closed")).not.toThrow();
  });

  test.each(["planned", "open", "finished"])(
    "з %s — 409 SESSION_STATE_CONFLICT",
    (state) => {
      expect(thrown(() => assertFinishable(state))).toEqual(
        expect.objectContaining({
          code: "SESSION_STATE_CONFLICT",
          statusCode: 409,
          message: `Заняття не можна перевести зі стану ${state} у finished`,
        }),
      );
    },
  );

  test("хтось здає — 409 SUBMITTING_IN_PROGRESS; ніхто — без помилки", () => {
    expect(() => assertNoSubmitting(false)).not.toThrow();
    expect(thrown(() => assertNoSubmitting(true))).toEqual(
      expect.objectContaining({
        code: "SUBMITTING_IN_PROGRESS",
        statusCode: 409,
      }),
    );
  });

  test("missed стають лише waiting і called", () => {
    expect(MISSED_ON_FINISH).toStrictEqual(["waiting", "called"]);
  });
});
