// sessions у пам'яті (ADR-0027): sessions.sessions і sessions.session_labs, як у data.md.

/**
 * @typedef {Omit<import("./model.js").Session, "labIds">} SessionRow
 * @typedef {{ sessionId: string, labId: string }} SessionLabRow
 */

/**
 * @param {{ store: import("../../platform/memory.js").MemoryStore }} deps
 * @returns {import("./repo.js").SessionsRepo}
 */
export function createSessionsRepoMemory({ store }) {
  /** @type {ReturnType<typeof store.table<SessionRow>>} */
  const sessions = store.table("sessions.sessions");
  /** @type {ReturnType<typeof store.table<SessionLabRow>>} */
  const sessionLabs = store.table("sessions.session_labs");

  /**
   * Лаби для кількох занять за один прохід — як один запит у PostgreSQL.
   * @param {SessionRow[]} rows
   * @returns {import("./model.js").Session[]}
   */
  function withLabs(rows) {
    const ids = new Set(rows.map((row) => row.id));
    /** @type {Map<string, string[]>} */
    const labs = new Map();
    for (const link of sessionLabs.all()) {
      if (!ids.has(link.sessionId)) continue;
      labs.set(link.sessionId, [
        ...(labs.get(link.sessionId) ?? []),
        link.labId,
      ]);
    }
    return rows.map((row) => ({
      ...row,
      labIds: (labs.get(row.id) ?? []).sort(),
    }));
  }

  return {
    async lockTeacher(teacherId) {
      await store.lockTeacher(teacherId);
    },
    async findById(id) {
      const row = sessions.get(id);
      return row ? withLabs([row])[0] : undefined;
    },
    async findByIds(ids) {
      const rows = [...new Set(ids)]
        .map((id) => sessions.get(id))
        .filter((row) => row !== undefined);
      return withLabs(rows);
    },
    async findByGroup(groupId) {
      const rows = sessions
        .all()
        .filter((row) => row.groupId === groupId)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return withLabs(rows);
    },
    async insert(session) {
      const { labIds, ...row } = session;
      sessions.put(row.id, row);
      for (const labId of labIds) {
        sessionLabs.put(`${row.id}\u0000${labId}`, {
          sessionId: row.id,
          labId,
        });
      }
    },
    async updateState(id, state) {
      const row = /** @type {SessionRow} */ (sessions.get(id));
      sessions.put(id, { ...row, state });
    },
  };
}
