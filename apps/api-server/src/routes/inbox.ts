import type { FastifyInstance } from "fastify";
import { inboxPaginationQuerySchema, sendMessageRequestSchema } from "@repo/shared-types";
import { createHostMessage, getThreadContext, getThreadMessages, listThreads } from "@repo/db";
import { llmDriver as defaultLlmDriver, type LLMDriver } from "../ai/llm-client";
import { publishInboxMessage } from "../realtime";
import { requireAuth, requireRole } from "../auth";

export interface InboxRouteDeps {
  llmDriver?: LLMDriver;
}

// Cleaner/maintenance logins are restricted to the task endpoints only (see Phase 9
// plan decision 2) — guest messaging is owner/manager territory.
const inboxPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerInboxRoutes(app: FastifyInstance, opts: InboxRouteDeps = {}) {
  // See routes/checkout.ts for why this is a per-field fallback rather than a JS
  // default parameter value — Fastify always passes `{}`, never `undefined`.
  const llmDriver = opts.llmDriver ?? defaultLlmDriver;

  app.get("/api/v1/inbox/threads", { preHandler: inboxPreHandler }, async (request, reply) => {
    const queryResult = inboxPaginationQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Invalid pagination parameters" } });
    }
    const { page, pageSize } = queryResult.data;

    const threads = await listThreads(request.accountId!, { page, pageSize });
    return reply.code(200).send({ threads, page, pageSize });
  });

  app.get("/api/v1/inbox/threads/:threadId/messages", { preHandler: inboxPreHandler }, async (request, reply) => {
    const params = request.params as { threadId: string };
    const queryResult = inboxPaginationQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Invalid pagination parameters" } });
    }
    const { page, pageSize } = queryResult.data;

    const messages = await getThreadMessages(request.accountId!, params.threadId, { page, pageSize });
    return reply.code(200).send({ messages, page, pageSize });
  });

  app.post("/api/v1/inbox/threads/:threadId/messages", { preHandler: inboxPreHandler }, async (request, reply) => {
    const params = request.params as { threadId: string };
    const bodyResult = sendMessageRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "content is required" } });
    }
    const { content } = bodyResult.data;
    const accountId = request.accountId!;

    const message = await createHostMessage(accountId, params.threadId, content);
    await publishInboxMessage(accountId, { threadId: params.threadId, message });

    return reply.code(201).send({ message });
  });

  app.post("/api/v1/inbox/threads/:threadId/suggest-reply", { preHandler: inboxPreHandler }, async (request, reply) => {
    const params = request.params as { threadId: string };
    const accountId = request.accountId!;

    const context = await getThreadContext(accountId, params.threadId);
    if (!context) {
      return reply
        .code(404)
        .send({ error: { code: "THREAD_NOT_FOUND", message: `No thread found for id ${params.threadId}` } });
    }

    const history = await getThreadMessages(accountId, params.threadId, { page: 1, pageSize: 20 });

    const draft = await llmDriver.generateReply({
      guestName: context.thread.guestName,
      channel: context.thread.channel,
      propertyName: context.property?.name ?? null,
      unitName: context.unit?.name ?? null,
      checkInInstructions: context.unit?.checkInInstructions ?? null,
      checkIn: context.reservation?.checkIn ?? null,
      checkOut: context.reservation?.checkOut ?? null,
      history: history.map((m) => ({ senderType: m.senderType, content: m.content })),
    });

    return reply.code(200).send({ draft });
  });
}
