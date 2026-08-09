import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerPublicRoutes } from "./routes/public";
import { registerCheckoutRoutes } from "./routes/checkout";
import { registerStripeWebhookRoutes } from "./routes/stripe-webhook";
import { registerInboxRoutes } from "./routes/inbox";
import { registerInboxWsRoutes } from "./routes/inbox-ws";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Signature verification needs the exact raw bytes, not Fastify's re-serialized JSON.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const raw = body as string;
    request.rawBody = raw;
    try {
      done(null, raw === "" ? {} : JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(websocketPlugin);
  app.register(registerWebhookRoutes);
  app.register(registerPublicRoutes);
  app.register(registerCheckoutRoutes);
  app.register(registerStripeWebhookRoutes);
  app.register(registerInboxRoutes);
  app.register(registerInboxWsRoutes);

  return app;
}
