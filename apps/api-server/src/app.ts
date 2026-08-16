import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import corsPlugin from "@fastify/cors";
import type { UserRole } from "@repo/shared-types";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerPublicRoutes } from "./routes/public";
import { registerCheckoutRoutes } from "./routes/checkout";
import { registerStripeWebhookRoutes } from "./routes/stripe-webhook";
import { registerInboxRoutes } from "./routes/inbox";
import { registerInboxWsRoutes } from "./routes/inbox-ws";
import { registerPricingWebhookRoutes } from "./routes/pricing-webhook";
import { registerAuthRoutes } from "./routes/auth";
import { registerHostRoutes } from "./routes/host";
import { registerReservationRoutes } from "./routes/reservations";
import { registerTaskRoutes } from "./routes/tasks";
import { registerOwnerRoutes } from "./routes/owners";
import { registerGuestRoutes } from "./routes/guest";
import { registerDiscountRoutes } from "./routes/discounts";
import { registerAddOnRoutes } from "./routes/add-ons";
import { registerDepositClaimRoutes } from "./routes/deposit-claims";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerSettingsRoutes } from "./routes/settings";
import { registerSiteRoutes } from "./routes/site";
import { registerChannelRoutes } from "./routes/channels";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    accountId?: string;
    userId?: string;
    userEmail?: string;
    userRole?: UserRole;
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
  app.register(registerReservationRoutes);
  app.register(registerTaskRoutes);
  app.register(registerOwnerRoutes);
  app.register(registerGuestRoutes);
  app.register(registerDiscountRoutes);
  app.register(registerAddOnRoutes);
  app.register(registerDepositClaimRoutes);
  app.register(registerAnalyticsRoutes);
  app.register(registerDashboardRoutes);
  app.register(registerSettingsRoutes);
  app.register(registerSiteRoutes);
  app.register(registerChannelRoutes);
  app.register(registerInboxRoutes);
  app.register(registerInboxWsRoutes);
  app.register(registerPricingWebhookRoutes);

  return app;
}
