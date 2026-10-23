// HTTP queue (ADR-0031): схеми й коди відповідей S5–S8, S10 (data.md, «HTTP-контракт»).
// Роути лише перетворюють HTTP на виклик сервісу; транзакцій тут немає.

const nullableString = { type: ["string", "null"] };

const entrySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    sessionId: { type: "string" },
    teacherId: { type: "string" },
    studentId: { type: "string" },
    labId: { type: "string" },
    status: { type: "string" },
    seq: { type: "integer" },
    enqueuedAt: { type: "string" },
    calledAt: nullableString,
    startedAt: nullableString,
    finishedAt: nullableString,
    score: { type: ["integer", "null"] },
  },
  required: ["id", "sessionId", "studentId", "labId", "status", "seq"],
};

const uuidParams = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
};

/** @param {{ params: unknown }} request */
const idOf = (request) => /** @type {{ id: string }} */ (request.params).id;

/**
 * @param {import("fastify").FastifyInstance} app
 * @param {{ service: import("./service.js").QueueService }} deps
 */
export function registerQueueRoutes(app, { service }) {
  // S10
  app.post(
    "/sessions/:id/queue",
    {
      config: { successStatus: 201 },
      schema: {
        params: uuidParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["labId"],
          properties: {
            labId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
        response: { 201: entrySchema },
      },
    },
    async (request, reply) => {
      const { labId } = /** @type {{ labId: string }} */ (request.body);
      return reply.code(201).send(await service.enqueue(idOf(request), labId));
    },
  );

  const command = { params: uuidParams, response: { 200: entrySchema } };

  // S5
  app.post(
    "/sessions/:id/queue/call-next",
    { schema: command },
    async (request) => service.callNext(idOf(request)),
  );

  // S6
  app.post("/entries/:id/start", { schema: command }, async (request) =>
    service.start(idOf(request)),
  );

  // S7
  app.post(
    "/entries/:id/result",
    {
      schema: {
        ...command,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["outcome"],
          properties: {
            outcome: { enum: ["passed", "rework"] },
            score: { type: "integer", minimum: 0, maximum: 100 },
          },
        },
      },
    },
    async (request) =>
      service.result(
        idOf(request),
        /** @type {import("./model.js").Result} */ (request.body),
      ),
  );

  // S8
  app.post(
    "/entries/:id/no-show",
    {
      schema: {
        params: uuidParams,
        response: {
          200: {
            type: "object",
            properties: {
              ...entrySchema.properties,
              noShowCount: { type: "integer" },
            },
            required: [...entrySchema.required, "noShowCount"],
          },
        },
      },
    },
    async (request) => {
      const { entry, noShowCount } = await service.noShow(idOf(request));
      return { ...entry, noShowCount };
    },
  );
}
