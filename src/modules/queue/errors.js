// Помилки queue за формою { code, statusCode } (ADR-0031, data.md «Каталог помилок»).
// SESSION_NOT_FOUND і NOT_SESSION_OWNER — ті самі коди, що в sessions: queue
// не імпортує внутрішніх файлів іншого модуля (правило 1).

/**
 * @param {string} code
 * @param {number} statusCode
 * @param {string} message
 */
function domainError(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

export const sessionNotFound = () =>
  domainError("SESSION_NOT_FOUND", 404, "Немає такого заняття");
export const entryNotFound = () =>
  domainError("ENTRY_NOT_FOUND", 404, "Немає такого запису в черзі");
export const notSessionOwner = () =>
  domainError("NOT_SESSION_OWNER", 403, "Заняття веде інший викладач");
export const notInGroup = () =>
  domainError("NOT_IN_GROUP", 403, "Студент не з групи заняття");
export const enrollmentClosed = () =>
  domainError("ENROLLMENT_CLOSED", 409, "Запис на заняття не відкритий");
export const labNotAccepted = () =>
  domainError("LAB_NOT_ACCEPTED", 409, "Ця лаба на занятті не приймається");
export const queueLimitReached = () =>
  domainError("QUEUE_LIMIT_REACHED", 409, "Ліміт черги вичерпано");
export const alreadyInQueue = () =>
  domainError("ALREADY_IN_QUEUE", 409, "Студент уже має активний запис");
export const droppedFromSession = () =>
  domainError("DROPPED_FROM_SESSION", 409, "Студент на цьому занятті вибув");
export const teacherBusy = () =>
  domainError(
    "TEACHER_BUSY",
    409,
    "У викладача вже є викликаний або той, хто здає",
  );
export const queueEmpty = () =>
  domainError("QUEUE_EMPTY", 409, "У черзі немає тих, хто очікує");
/** @param {string} from @param {string} to */
export const entryStateConflict = (from, to) =>
  domainError(
    "ENTRY_STATE_CONFLICT",
    409,
    `Запис не можна перевести зі стану ${from} у ${to}`,
  );
/** @param {string} detail */
export const scoreMismatch = (detail) =>
  domainError("SCORE_MISMATCH", 422, detail);
