// queue у PostgreSQL (ADR-0032): queue.entries і queue.no_shows. Кожна
// функція — один запит із data.md, «Запити сценаріїв»; жодна не ходить у
// циклі за кількістю записів.

/** @typedef {import("./model.js").Entry} Entry */

/** @param {Date | null} value */
const iso = (value) => (value ? value.toISOString() : null);

/**
 * @param {any} row
 * @returns {Entry}
 */
const toEntry = (row) => ({
  id: row.id,
  sessionId: row.sessionId,
  teacherId: row.teacherId,
  studentId: row.studentId,
  labId: row.labId,
  status: row.status,
  seq: row.seq,
  enqueuedAt: row.enqueuedAt.toISOString(),
  calledAt: iso(row.calledAt),
  startedAt: iso(row.startedAt),
  finishedAt: iso(row.finishedAt),
  score: row.score,
});

const COLUMNS = `id, session_id, teacher_id, student_id, lab_id, status, seq,
  enqueued_at, called_at, started_at, finished_at, score`;

/**
 * @param {{ db: import("../../platform/db/index.js").DbAccess }} deps
 * @returns {import("./repo.js").QueueRepo}
 */
export function createQueueRepoPg({ db }) {
  const sql = () => db.read();
  const columns = () => db.read()(COLUMNS.split(/,\s*/));

  return {
    async lockTeacher(teacherId) {
      await db.write()`
        select pg_advisory_xact_lock(hashtextextended(${`teacher:${teacherId}`}, 0))`;
    },
    async findEntry(id) {
      const [row] = await sql()`
        select ${columns()} from queue.entries where id = ${id}`;
      return row ? toEntry(row) : undefined;
    },
    async activeOfStudent(sessionId, studentId) {
      const [row] = await sql()`
        select ${columns()} from queue.entries
        where session_id = ${sessionId} and student_id = ${studentId}
          and status in ('waiting', 'called', 'submitting')`;
      return row ? toEntry(row) : undefined;
    },
    async countActive(sessionId) {
      const [row] = await sql()`
        select count(*)::int as n from queue.entries
        where session_id = ${sessionId}
          and status in ('waiting', 'called', 'submitting')`;
      return row.n;
    },
    async maxSeq(sessionId) {
      const [row] = await sql()`
        select coalesce(max(seq), 0)::int as n from queue.entries
        where session_id = ${sessionId}`;
      return row.n;
    },
    async firstWaiting(sessionId) {
      const [row] = await sql()`
        select ${columns()} from queue.entries
        where session_id = ${sessionId} and status = 'waiting'
        order by seq limit 1`;
      return row ? toEntry(row) : undefined;
    },
    async teacherBusy(teacherId) {
      const [row] = await sql()`
        select exists (
          select 1 from queue.entries
          where teacher_id = ${teacherId} and status in ('called', 'submitting')
        ) as busy`;
      return row.busy;
    },
    async insertEntry(entry) {
      await db.write()`
        insert into queue.entries
          (id, session_id, teacher_id, student_id, lab_id, status, seq,
           enqueued_at, called_at, started_at, finished_at, score)
        values (${entry.id}, ${entry.sessionId}, ${entry.teacherId},
          ${entry.studentId}, ${entry.labId}, ${entry.status}, ${entry.seq},
          ${entry.enqueuedAt}, ${entry.calledAt}, ${entry.startedAt},
          ${entry.finishedAt}, ${entry.score})`;
    },
    async updateEntry(entry) {
      await db.write()`
        update queue.entries
        set status = ${entry.status}, seq = ${entry.seq},
          called_at = ${entry.calledAt}, started_at = ${entry.startedAt},
          finished_at = ${entry.finishedAt}, score = ${entry.score}
        where id = ${entry.id}`;
    },
    async noShowCount(sessionId, studentId) {
      const [row] = await sql()`
        select count from queue.no_shows
        where session_id = ${sessionId} and student_id = ${studentId}`;
      return row?.count ?? 0;
    },
    async addNoShow(sessionId, studentId) {
      const [row] = await db.write()`
        insert into queue.no_shows (session_id, student_id, count)
        values (${sessionId}, ${studentId}, 1)
        on conflict (session_id, student_id)
          do update set count = queue.no_shows.count + 1
        returning count`;
      return row.count;
    },
    async hasSubmitting(sessionId) {
      const [row] = await sql()`
        select exists (
          select 1 from queue.entries
          where session_id = ${sessionId} and status = 'submitting'
        ) as busy`;
      return row.busy;
    },
    async missActive(sessionId, at) {
      const result = await db.write()`
        update queue.entries set status = 'missed', finished_at = ${at}
        where session_id = ${sessionId} and status in ('waiting', 'called')`;
      return result.count;
    },
    async summaries(sessionIds) {
      if (sessionIds.length === 0) return [];
      const rows = await sql()`
        select session_id,
          (count(*) filter (where status = 'waiting'))::int as waiting_count,
          max(student_id) filter (where status in ('called', 'submitting'))
            as called_student_id
        from queue.entries
        where session_id = any(${[...new Set(sessionIds)]}::uuid[])
        group by session_id`;
      return rows.map((row) => ({
        sessionId: row.sessionId,
        waitingCount: row.waitingCount,
        calledStudentId: row.calledStudentId ?? null,
      }));
    },
    async rankOf(sessionId, seq) {
      const [row] = await sql()`
        select (count(*) + 1)::int as n from queue.entries
        where session_id = ${sessionId} and status = 'waiting' and seq < ${seq}`;
      return row.n;
    },
    async averageDurationMs(sessionId, limit) {
      const [row] = await sql()`
        select avg(extract(epoch from finished_at - called_at) * 1000)::float8 as avg
        from (
          select called_at, finished_at from queue.entries
          where session_id = ${sessionId} and status in ('passed', 'rework')
            and called_at is not null and finished_at is not null
          order by finished_at desc
          limit ${limit}
        ) recent`;
      return row.avg ?? null;
    },
    async historyOf(studentId) {
      const rows = await sql()`
        select ${columns()} from queue.entries
        where student_id = ${studentId} and status in ('passed', 'rework')
        order by finished_at desc`;
      return rows.map(toEntry);
    },
  };
}
