// HTTP identity (ADR-0031): хук автентифікації для всіх маршрутів, крім
// технічних (config.public). onRequest — щоб 401 ішов раніше за 400 (data.md).

/**
 * @param {import("fastify").FastifyInstance} app
 * @param {{ service: import("./service.js").IdentityService }} deps
 */
export function registerIdentityRoutes(app, { service }) {
  app.addHook("onRequest", async (request) => {
    const config = /** @type {{ public?: boolean }} */ (
      request.routeOptions.config
    );
    if (config.public) return;
    const header = request.headers["x-user-id"];
    await service.authenticate(typeof header === "string" ? header : undefined);
  });
}
