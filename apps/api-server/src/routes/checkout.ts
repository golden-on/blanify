import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";
import { checkoutSessionRequestSchema } from "@repo/shared-types";
import { getStripeAccountForTenant, nightlyAvailability, nightsBetween, recordPendingPayment, withTenant } from "@repo/db";
import { stripe } from "../stripe-client";

export interface CheckoutClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
    };
  };
}

export interface CheckoutRouteDeps {
  stripeClient?: CheckoutClient;
}

export async function registerCheckoutRoutes(app: FastifyInstance, opts: CheckoutRouteDeps = {}) {
  // Fastify's `.register(plugin)` always calls plugins with an `opts` object (`{}`
  // when none is passed), never `undefined` — so a default parameter value on `opts`
  // itself would never apply. The fallback has to happen per-field instead.
  const stripeClient = opts.stripeClient ?? stripe;

  app.post("/api/v1/public/checkout/create-session", async (request, reply) => {
    const bodyResult = checkoutSessionRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_PAYLOAD", message: "accountId, unitId, checkIn, and checkOut are required" } });
    }
    const { accountId, unitId, checkIn, checkOut } = bodyResult.data;

    const dates = nightsBetween(checkIn, checkOut);
    if (dates.length === 0) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_DATE_RANGE", message: "checkOut must be after checkIn" } });
    }

    const nights = await withTenant(accountId, (tx) =>
      tx
        .select()
        .from(nightlyAvailability)
        .where(and(eq(nightlyAvailability.unitId, unitId), inArray(nightlyAvailability.date, dates))),
    );

    if (nights.length !== dates.length || nights.some((night) => night.status !== "available")) {
      return reply
        .code(409)
        .send({ error: { code: "DATES_UNAVAILABLE", message: "One or more requested nights are not available" } });
    }

    if (nights.some((night) => night.priceInCents === null)) {
      return reply.code(400).send({
        error: { code: "PRICING_INCOMPLETE", message: "One or more requested nights have no price configured" },
      });
    }

    const amountInCents = nights.reduce((sum, night) => sum + (night.priceInCents ?? 0), 0);

    const stripeAccount = await getStripeAccountForTenant(accountId);
    if (!stripeAccount || !stripeAccount.chargesEnabled) {
      return reply.code(400).send({
        error: { code: "STRIPE_ACCOUNT_NOT_READY", message: "This host is not yet able to accept payments" },
      });
    }

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountInCents,
            product_data: { name: `Reservation for unit ${unitId} (${checkIn} to ${checkOut})` },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        transfer_data: { destination: stripeAccount.stripeAccountId },
      },
      metadata: { accountId, unitId, checkIn, checkOut },
      success_url: process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? "http://localhost:3001/booking/success",
      cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL ?? "http://localhost:3001/booking/cancel",
    });

    if (!session.payment_intent || typeof session.payment_intent !== "string") {
      return reply.code(502).send({
        error: { code: "STRIPE_SESSION_INCOMPLETE", message: "Stripe did not return a payment intent for this session" },
      });
    }

    await recordPendingPayment({
      accountId,
      stripePaymentIntentId: session.payment_intent,
      amountInCents,
      currency: "usd",
    });

    return reply.code(200).send({ sessionId: session.id, url: session.url });
  });
}
