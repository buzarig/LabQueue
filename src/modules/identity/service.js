// Сервіс identity (ADR-0031): хто робить запит і чи має він потрібну роль.
// Користувача кладе в контекст запиту, звідки його беруть інші модулі й логи
// (ADR-0030).
import { forbiddenRole, unauthenticated } from "./errors.js";

/**
 * @param {{
 *   repo: import("./repo.js").IdentityRepo,
 *   context: import("../../platform/context.js").Context,
 * }} deps
 */
export function createIdentityService({ repo, context }) {
  return {
    /**
     * Автентифікація за X-User-Id (data.md): невідомий або відсутній → 401.
     * @param {string | undefined} userId
     */
    async authenticate(userId) {
      const user = userId ? await repo.findById(userId) : undefined;
      if (!user) throw unauthenticated();
      context.current().user = {
        id: user.id,
        role: user.role,
        groupId: user.groupId,
      };
    },

    /**
     * Поточний користувач-ініціатор.
     * @returns {import("../../platform/context.js").ContextUser}
     */
    currentUser() {
      const user = context.current().user;
      if (!user) throw unauthenticated();
      return user;
    },

    /**
     * Поточний користувач із потрібною роллю, інакше 403 FORBIDDEN_ROLE.
     * @param {import("./model.js").Role} role
     */
    requireRole(role) {
      const user = this.currentUser();
      if (user.role !== role) throw forbiddenRole(role);
      return user;
    },
  };
}

/** @typedef {ReturnType<typeof createIdentityService>} IdentityService */
