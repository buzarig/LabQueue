// HTTP queue (ADR-0031): схеми й коди відповідей S4–S13 (data.md, «HTTP-контракт»).
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
  const sessionProps = {
    id: { type: "string" },
    subjectId: { type: "string" },
    groupId: { type: "string" },
    teacherId: { type: "string" },
    startsAt: { type: "string" },
    room: { type: "string" },
    queueLimit: { type: "integer" },
    state: { type: "string" },
    labIds: { type: "array", items: { type: "string" } },
  };

  // S4 — координує queue (ADR-0005)
  app.post(
    "/sessions/:id/finish",
    {
      schema: {
        params: uuidParams,
        response: {
          200: {
            type: "object",
            properties: { ...sessionProps, missedCount: { type: "integer" } },
            required: ["id", "state", "missedCount"],
          },
        },
      },
    },
    async (request) => service.finish(idOf(request)),
  );

  // S9
  app.get(
    "/sessions",
    {
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ...sessionProps,
                waitingCount: { type: "integer" },
                calledStudentId: nullableString,
              },
              required: ["id", "state", "waitingCount", "calledStudentId"],
            },
          },
        },
      },
    },
    async () => service.listForStudent(),
  );

  // S11
  app.get(
    "/sessions/:id/queue/me",
    {
      schema: {
        params: uuidParams,
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              position: { type: ["integer", "null"] },
              etaMinutes: { type: ["integer", "null"] },
            },
            required: ["status", "position", "etaMinutes"],
          },
        },
      },
    },
    async (request) => service.myPosition(idOf(request)),
  );

  // S12
  app.post(
    "/entries/:id/leave",
    { schema: { params: uuidParams, response: { 200: entrySchema } } },
    async (request) => service.leave(idOf(request)),
  );

  // S13
  app.get(
    "/me/history",
    {
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entryId: { type: "string" },
                sessionId: { type: "string" },
                startsAt: { type: "string" },
                subjectId: { type: "string" },
                subjectName: { type: "string" },
                labId: { type: "string" },
                labNumber: { type: "integer" },
                labTitle: { type: "string" },
                status: { type: "string" },
                score: { type: ["integer", "null"] },
                finishedAt: { type: "string" },
              },
              required: [
                "entryId",
                "sessionId",
                "labId",
                "status",
                "finishedAt",
              ],
            },
          },
        },
      },
    },
    async () => service.history(),
  );

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
