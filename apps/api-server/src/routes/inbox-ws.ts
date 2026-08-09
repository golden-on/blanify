import type { FastifyInstance } from "fastify";
import { inboxChannelForAccount } from "@repo/shared-types";
import { createSubscriber } from "../realtime";

export async function registerInboxWsRoutes(app: FastifyInstance) {
  app.get("/api/v1/inbox/ws", { websocket: true }, (socket, request) => {
    const query = request.query as { accountId?: string };
    const accountId = query.accountId;

    if (!accountId) {
      socket.close(1008, "accountId query parameter is required");
      return;
    }

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
