// Моделі identity (ADR-0031): користувач і роль (architecture.md, «Дані (ER)»).

/** @typedef {"student" | "teacher"} Role */

/**
 * groupId — лише в студента (data.md, identity.users).
 * @typedef {{ id: string, name: string, role: Role, groupId: string | null }} User
 */

export {};
