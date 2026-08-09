import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { recordWebhookEvent } from "@repo/db";
import { enqueueStripeWebhook } from "@repo/queue";
import { stripe } from "../stripe-client";

export interface StripeSignatureClient {
  webhooks: {
    constructEvent(payload: string, header: string, secret: string): Stripe.Event;
  };
}

export interface StripeWebhookRouteDeps {
  stripeClient?: StripeSignatureClient;
}

export async function registerStripeWebhookRoutes(app: FastifyInstance, opts: StripeWebhookRouteDeps = {}) {
  // See checkout.ts for why the fallback is per-field rather than a default `opts` value.
  const stripeClient = opts.stripeClient ?? stripe;

  app.post("/api/v1/webhooks/stripe", async (request, reply) => {
    const signatureHeader = request.headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    let event: Stripe.Event;
    try {
      if (!signature) {
        throw new Error("Missing stripe-signature header");
      }
      event = stripeClient.webhooks.constructEvent(
        request.rawBody ?? "",
        signature,
        process.env.STRIPE_WEBHOOK_SECRET ?? "",
      );
    } catch {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
    }

    const recorded = await recordWebhookEvent("stripe", event.id, event);
    if (!recorded) {
      return reply.code(200).send({ status: "duplicate" });
    }

    if (event.type !== "checkout.session.completed") {
      // Stripe sends every subscribed event type to one endpoint; we only act on this
      // one, but still record the rest above for idempotency/audit.
      return reply.code(200).send({ status: "ignored" });
    }

    await enqueueStripeWebhook({ webhookEventId: recorded.id });
    return reply.code(202).send({ status: "accepted" });
  });
}
