import type { FastifyInstance, FastifyReply } from "fastify";
import { TenantAccessError, createIcalFeedSchema } from "@repo/shared-types";
import { createIcalFeed, deleteIcalFeed, getChannelStatusForAccount, listIcalFeedsForAccount } from "@repo/db";
import { enqueueIcalSync } from "@repo/queue";
import { requireAuth, requireRole } from "../auth";

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

function sendTenantAccessDenied(reply: FastifyReply, err: TenantAccessError) {
  return reply.code(403).send({ error: { code: err.code, message: err.message } });
}

export async function registerChannelRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/channels", { preHandler: hostPreHandler }, async (request, reply) => {
    const [channels, icalFeeds] = await Promise.all([
      getChannelStatusForAccount(request.accountId!),
      listIcalFeedsForAccount(request.accountId!),
    ]);
    return reply.code(200).send({ channels, icalFeeds });
  });

  app.post("/api/v1/host/channels/sync", { preHandler: hostPreHandler }, async (request, reply) => {
    const feeds = await listIcalFeedsForAccount(request.accountId!);
    await Promise.all(feeds.map((feed) => enqueueIcalSync({ feedId: feed.id, accountId: request.accountId! })));
    return reply.code(202).send({ status: "accepted", queued: feeds.length });
  });

  app.post("/api/v1/host/channels/ical-feeds", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createIcalFeedSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "unitId, name, and url are required" } });
    }

    try {
      const feed = await createIcalFeed(request.accountId!, bodyResult.data);
      return reply.code(201).send({ feed });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.delete("/api/v1/host/channels/ical-feeds/:feedId", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { feedId: string };
    await deleteIcalFeed(request.accountId!, params.feedId);
    return reply.code(204).send();
  });
}
