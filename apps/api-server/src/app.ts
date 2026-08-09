import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import corsPlugin from "@fastify/cors";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerPublicRoutes } from "./routes/public";
import { registerCheckoutRoutes } from "./routes/checkout";
import { registerStripeWebhookRoutes } from "./routes/stripe-webhook";
import { registerInboxRoutes } from "./routes/inbox";
import { registerInboxWsRoutes } from "./routes/inbox-ws";
import { registerPricingWebhookRoutes } from "./routes/pricing-webhook";
import { registerAuthRoutes } from "./routes/auth";
import { registerHostRoutes } from "./routes/host";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    accountId?: string;
    userId?: string;
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

  // Permissive for dev — the admin app (a different origin/port) needs to call this
  // API and open a WebSocket to it; nothing before this phase needed cross-origin calls.
  app.register(corsPlugin, { origin: true });
  app.register(websocketPlugin);
  app.register(registerWebhookRoutes);
  app.register(registerPublicRoutes);
  app.register(registerCheckoutRoutes);
  app.register(registerStripeWebhookRoutes);
  app.register(registerAuthRoutes);
  app.register(registerHostRoutes);
  app.register(registerInboxRoutes);
  app.register(registerInboxWsRoutes);
  app.register(registerPricingWebhookRoutes);

  return app;
}
