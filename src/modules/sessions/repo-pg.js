// sessions у PostgreSQL (ADR-0032): sessions.sessions і sessions.session_labs.
// Лаби заняття — тим самим запитом (array_agg), без запиту на кожне заняття.

/** @typedef {import("./model.js").Session} Session */

/**
 * @param {any} row
 * @returns {Session}
 */
const toSession = (row) => ({
  id: row.id,
  subjectId: row.subjectId,
  groupId: row.groupId,
  teacherId: row.teacherId,
  startsAt: row.startsAt.toISOString(),
  room: row.room,
  queueLimit: row.queueLimit,
  state: row.state,
  labIds: row.labIds,
});

/**
 * @param {{ db: import("../../platform/db/index.js").DbAccess }} deps
 * @returns {import("./repo.js").SessionsRepo}
 */
export function createSessionsRepoPg({ db }) {
  /**
   * Заняття з лабами за умовою.
   * @param {any} where фрагмент SQL
   */
  async function select(where) {
    const sql = db.read();
    const rows = await sql`
      select s.id, s.subject_id, s.group_id, s.teacher_id, s.starts_at, s.room,
        s.queue_limit, s.state,
        coalesce(array_agg(sl.lab_id order by sl.lab_id)
          filter (where sl.lab_id is not null), '{}') as lab_ids
      from sessions.sessions s
      left join sessions.session_labs sl on sl.session_id = s.id
      where ${where}
      group by s.id
      order by s.starts_at, s.id`;
    return rows.map(toSession);
  }

  return {
    async lockTeacher(teacherId) {
      await db.write()`
        select pg_advisory_xact_lock(hashtextextended(${`teacher:${teacherId}`}, 0))`;
    },
    async findById(id) {
      const sql = db.read();
      return (await select(sql`s.id = ${id}`))[0];
    },
    async findByIds(ids) {
      if (ids.length === 0) return [];
      const sql = db.read();
      return select(sql`s.id = any(${[...new Set(ids)]}::uuid[])`);
    },
    async findByGroup(groupId) {
      const sql = db.read();
      return select(sql`s.group_id = ${groupId}`);
    },
    async insert(session) {
      const sql = db.write();
      await sql`
        insert into sessions.sessions
          (id, subject_id, group_id, teacher_id, starts_at, room, queue_limit, state)
        values (${session.id}, ${session.subjectId}, ${session.groupId},
          ${session.teacherId}, ${session.startsAt}, ${session.room},
          ${session.queueLimit}, ${session.state})`;
      await sql`
        insert into sessions.session_labs (session_id, lab_id)
        select ${session.id}, unnest(${session.labIds}::text[])`;
    },
    async updateState(id, state) {
      await db.write()`
        update sessions.sessions set state = ${state} where id = ${id}`;
    },
  };
}
