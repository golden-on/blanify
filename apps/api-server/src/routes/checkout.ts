import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";
import { checkoutSessionRequestSchema } from "@repo/shared-types";
import {
  evaluateDiscount,
  getStripeAccountForTenant,
  getUnitAddOns,
  nightlyAvailability,
  nightsBetween,
  recordPendingPayment,
  withTenant,
} from "@repo/db";
import { stripe } from "../stripe-client";

export interface CheckoutClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
    };
  };
  coupons: {
    create(params: Stripe.CouponCreateParams): Promise<Stripe.Coupon>;
  };
}

export interface CheckoutRouteDeps {
  stripeClient?: CheckoutClient;
}

export async function registerCheckoutRoutes(app: FastifyInstance, opts: CheckoutRouteDeps = {}) {
  // See routes/checkout.ts (this file) history for why this is a per-field fallback
  // rather than a JS default parameter value — Fastify always passes `{}`, never
  // `undefined`.
  const stripeClient = opts.stripeClient ?? stripe;

  app.post("/api/v1/public/checkout/create-session", async (request, reply) => {
    const bodyResult = checkoutSessionRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_PAYLOAD", message: "accountId, unitId, checkIn, and checkOut are required" } });
    }
    const { accountId, unitId, checkIn, checkOut, promoCode, selectedAddOnIds } = bodyResult.data;

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

    const nightlyTotalInCents = nights.reduce((sum, night) => sum + (night.priceInCents ?? 0), 0);

    const unitAddOns = await getUnitAddOns(accountId, unitId);
    const invalidAddOnIds = selectedAddOnIds.filter((id) => !unitAddOns.some((addOn) => addOn.id === id));
    if (invalidAddOnIds.length > 0) {
      return reply.code(400).send({
        error: { code: "INVALID_ADD_ON", message: `Add-on(s) not found for this unit: ${invalidAddOnIds.join(", ")}` },
      });
    }

    const includedAddOns = unitAddOns
      .filter((addOn) => addOn.isRequired || selectedAddOnIds.includes(addOn.id))
      .map((addOn) => ({
        addOn,
        totalInCents: addOn.feeType === "per_night" ? addOn.priceInCents * dates.length : addOn.priceInCents,
      }));
    const addOnsTotalInCents = includedAddOns.reduce((sum, { totalInCents }) => sum + totalInCents, 0);

    let discountInCents = 0;
    if (promoCode) {
      const discountResult = await evaluateDiscount({
        accountId,
        code: promoCode,
        nightlyTotalInCents,
        stayNights: dates.length,
      });
      if (!discountResult.valid) {
        return reply.code(400).send({ error: { code: "INVALID_PROMO_CODE", message: discountResult.reason } });
      }
      discountInCents = discountResult.discountInCents;
    }

    const totalInCents = Math.max(0, nightlyTotalInCents + addOnsTotalInCents - discountInCents);

    const stripeAccount = await getStripeAccountForTenant(accountId);
    if (!stripeAccount || !stripeAccount.chargesEnabled) {
      return reply.code(400).send({
        error: { code: "STRIPE_ACCOUNT_NOT_READY", message: "This host is not yet able to accept payments" },
      });
    }

    // Stripe rejects negative unit_amount, so an itemized discount can't be a line
    // item — it has to be a dynamically created, single-use coupon attached via
    // `discounts`. Line items stay itemized and positive (nightly rate + each
    // included add-on).
    let sessionDiscounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (discountInCents > 0) {
      const coupon = await stripeClient.coupons.create({ amount_off: discountInCents, currency: "usd", duration: "once" });
      sessionDiscounts = [{ coupon: coupon.id }];
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: nightlyTotalInCents,
          product_data: { name: `Nightly rate for unit ${unitId} (${checkIn} to ${checkOut})` },
        },
      },
      ...includedAddOns.map(({ addOn, totalInCents: addOnTotal }) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: addOnTotal,
          product_data: { name: addOn.name },
        },
      })),
    ];

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      ...(sessionDiscounts ? { discounts: sessionDiscounts } : {}),
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
      amountInCents: totalInCents,
      currency: "usd",
    });

    return reply.code(200).send({ sessionId: session.id, url: session.url });
  });
}
