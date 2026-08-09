import type { FastifyInstance } from "fastify";
import { inboxChannelForAccount } from "@repo/shared-types";
import { createSubscriber } from "../realtime";
import { requireAuth } from "../auth";

export async function registerInboxWsRoutes(app: FastifyInstance) {
  app.get("/api/v1/inbox/ws", { websocket: true, preHandler: requireAuth }, (socket, request) => {
    // requireAuth already replied 401 and aborted the handshake for a missing/invalid
    // token — reaching here means request.accountId is guaranteed to be set.
    const accountId = request.accountId!;

    // A dedicated connection per socket — SUBSCRIBE puts a Redis connection into a
    // restricted mode, so it can't be shared with the publisher or other sockets.
    const subscriber = createSubscriber();
    const channel = inboxChannelForAccount(accountId);

    subscriber.subscribe(channel).catch((err: unknown) => {
      request.log.error(err, "Failed to subscribe to inbox channel");
    });

    subscriber.on("message", (_channel, message) => {
      socket.send(message);
    });

    socket.on("close", () => {
      void subscriber.quit();
    });
  });
}
