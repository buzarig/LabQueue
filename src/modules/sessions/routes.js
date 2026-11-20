// HTTP sessions (ADR-0031): схеми й коди відповідей S1–S3 (data.md, «HTTP-контракт»).
// Роути лише перетворюють HTTP на виклик сервісу; транзакцій тут немає.

const id = { type: "string", minLength: 1, maxLength: 100 };

const sessionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    subjectId: { type: "string" },
    groupId: { type: "string" },
    teacherId: { type: "string" },
    startsAt: { type: "string" },
    room: { type: "string" },
    queueLimit: { type: "integer" },
    state: { type: "string" },
    labIds: { type: "array", items: { type: "string" } },
  },
  required: [
    "id",
    "subjectId",
    "groupId",
    "teacherId",
    "startsAt",
    "room",
    "queueLimit",
    "state",
    "labIds",
  ],
};

const byId = {
  params: {
    type: "object",
    properties: { id: { type: "string", format: "uuid" } },
    required: ["id"],
  },
  response: { 200: sessionSchema },
};

/**
 * @param {import("fastify").FastifyInstance} app
 * @param {{ service: import("./service.js").SessionsService }} deps
 */
export function registerSessionsRoutes(app, { service }) {
  // S1
  app.post(
    "/sessions",
    {
      config: { successStatus: 201 },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "subjectId",
            "groupId",
            "startsAt",
            "room",
            "queueLimit",
            "labIds",
          ],
          properties: {
            subjectId: id,
            groupId: id,
            startsAt: { type: "string", format: "date-time" },
            room: { type: "string", minLength: 1, maxLength: 50 },
            queueLimit: { type: "integer", minimum: 1, maximum: 500 },
            labIds: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              uniqueItems: true,
              items: id,
            },
          },
        },
        response: { 201: sessionSchema },
      },
    },
    async (request, reply) => {
      const input = /** @type {import("./model.js").NewSession} */ (
        request.body
      );
      return reply.code(201).send(await service.create(input));
    },
  );

  /** @param {{ params: unknown }} request */
  const idOf = (request) => /** @type {{ id: string }} */ (request.params).id;

  // S2, S3
  app.post("/sessions/:id/open", { schema: byId }, async (request) =>
    service.open(idOf(request)),
  );
  app.post("/sessions/:id/close", { schema: byId }, async (request) =>
    service.close(idOf(request)),
  );
}
