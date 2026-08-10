import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { claimDepositRequestSchema } from "@repo/shared-types";
import { createDepositClaim, getCapturedDepositTotal, getPaymentByReservationId, getReservationById } from "@repo/db";
import { requireAuth, requireRole } from "../auth";
import { stripe } from "../stripe-client";

export interface DepositClient {
  paymentIntents: {
    capture(id: string, params: Stripe.PaymentIntentCaptureParams): Promise<Stripe.PaymentIntent>;
  };
}

export interface DepositClaimRouteDeps {
  stripeClient?: DepositClient;
}

const depositClaimPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerDepositClaimRoutes(app: FastifyInstance, opts: DepositClaimRouteDeps = {}) {
  const stripeClient = opts.stripeClient ?? stripe;

  app.post(
    "/api/v1/host/reservations/:reservationId/claim-deposit",
    { preHandler: depositClaimPreHandler },
    async (request, reply) => {
      const params = request.params as { reservationId: string };
      const bodyResult = claimDepositRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply
          .code(400)
          .send({ error: { code: "INVALID_PAYLOAD", message: "amountInCents and reason are required" } });
      }
      const { amountInCents, reason, evidenceUrls } = bodyResult.data;
      const accountId = request.accountId!;

      const reservation = await getReservationById(accountId, params.reservationId);
      if (!reservation) {
        return reply
          .code(404)
          .send({ error: { code: "RESERVATION_NOT_FOUND", message: `No reservation found for id ${params.reservationId}` } });
      }

      const payment = await getPaymentByReservationId(accountId, reservation.id);
      if (!payment || payment.status !== "succeeded") {
        return reply.code(400).send({
          error: { code: "NO_PREAUTH_HOLD", message: "This reservation has no active pre-authorized payment hold" },
        });
      }

      const alreadyCaptured = await getCapturedDepositTotal(accountId, reservation.id);
      if (alreadyCaptured + amountInCents > payment.amountInCents) {
        return reply.code(400).send({
          error: {
            code: "DEPOSIT_AMOUNT_EXCEEDS_HOLD",
            message: `Requested amount exceeds the remaining pre-auth hold (${payment.amountInCents - alreadyCaptured} cents available)`,
          },
        });
      }

      let paymentIntent: Stripe.PaymentIntent;
      try {
        paymentIntent = await stripeClient.paymentIntents.capture(payment.stripePaymentIntentId, {
          amount_to_capture: amountInCents,
        });
      } catch (err) {
        return reply.code(502).send({
          error: { code: "STRIPE_CAPTURE_FAILED", message: err instanceof Error ? err.message : String(err) },
        });
      }

      const depositClaim = await createDepositClaim({
        accountId,
        reservationId: reservation.id,
        paymentId: payment.id,
        amountInCents,
        reason,
        evidenceUrls,
      });

      return reply.code(201).send({ depositClaim, stripePaymentIntentStatus: paymentIntent.status });
    },
  );
}
