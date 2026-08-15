import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { cancelReservationSchema } from "@repo/shared-types";
import { cancelReservation, getReservationDetail, markPaymentRefunded } from "@repo/db";
import { requireAuth, requireRole } from "../auth";
import { stripe } from "../stripe-client";

export interface ReservationRefundClient {
  refunds: {
    create(params: Stripe.RefundCreateParams): Promise<Stripe.Refund>;
  };
}

export interface ReservationRouteDeps {
  stripeClient?: ReservationRefundClient;
}

const reservationPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerReservationRoutes(app: FastifyInstance, opts: ReservationRouteDeps = {}) {
  const stripeClient = opts.stripeClient ?? stripe;

  app.post(
    "/api/v1/host/reservations/:reservationId/cancel",
    { preHandler: reservationPreHandler },
    async (request, reply) => {
      const params = request.params as { reservationId: string };
      const bodyResult = cancelReservationSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "Invalid cancellation payload" } });
      }
      const accountId = request.accountId!;

      const detail = await getReservationDetail(accountId, params.reservationId);
      if (!detail) {
        return reply
          .code(404)
          .send({ error: { code: "RESERVATION_NOT_FOUND", message: `No reservation found for id ${params.reservationId}` } });
      }
      if (detail.reservation.status === "cancelled") {
        return reply.code(400).send({ error: { code: "ALREADY_CANCELLED", message: "This reservation is already cancelled" } });
      }

      if (bodyResult.data.refund) {
        const payment = detail.payment;
        if (!payment || payment.status !== "succeeded") {
          return reply.code(400).send({
            error: { code: "NO_REFUNDABLE_PAYMENT", message: "This reservation has no succeeded payment to refund" },
          });
        }

        try {
          await stripeClient.refunds.create({ payment_intent: payment.stripePaymentIntentId, amount: payment.amountInCents });
        } catch (err) {
          return reply.code(502).send({
            error: { code: "STRIPE_REFUND_FAILED", message: err instanceof Error ? err.message : String(err) },
          });
        }

        await markPaymentRefunded(accountId, payment.id);
      }

      const cancelled = await cancelReservation(accountId, params.reservationId);
      return reply.code(200).send({ reservation: cancelled });
    },
  );
}
