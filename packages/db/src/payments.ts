import { eq } from "drizzle-orm";
import { ChannelSyncError, ConcurrencyError, stripeCheckoutSessionObjectSchema } from "@repo/shared-types";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { createReservation } from "./inventory";
import { webhookEvents } from "./schema/webhook-events";
import { payments } from "./schema/payments";

export interface RecordPendingPaymentInput {
  accountId: string;
  stripePaymentIntentId: string;
  amountInCents: number;
  currency: string;
}

export async function recordPendingPayment(input: RecordPendingPaymentInput) {
  return withTenant(input.accountId, async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({
        accountId: input.accountId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        amountInCents: input.amountInCents,
        currency: input.currency,
        status: "pending",
      })
      .returning();

    if (!payment) {
      throw new Error("Failed to record pending payment");
    }

    return payment;
  });
}

export interface ProcessedStripeWebhookResult {
  accountId: string;
  reservationId: string;
}

export async function processStripeWebhookEvent(webhookEventId: string): Promise<ProcessedStripeWebhookResult | null> {
  const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId));
  if (!event) {
    throw new ChannelSyncError(`Webhook event ${webhookEventId} not found`);
  }

  if (event.status === "processed") {
    // Already handled — avoid reprocessing on job redelivery (BullMQ retry after a lost ack).
    return null;
  }

  try {
    const stripeEvent = event.payload as { data?: { object?: unknown } };
    const session = stripeCheckoutSessionObjectSchema.parse(stripeEvent.data?.object);
    const { accountId, unitId, checkIn, checkOut } = session.metadata;

    const payment = await withTenant(accountId, async (tx) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, session.payment_intent));
      return row;
    });

    if (!payment) {
      throw new ChannelSyncError(`No payments row found for stripePaymentIntentId=${session.payment_intent}`);
    }

    try {
      const reservation = await createReservation({ accountId, unitId, checkIn, checkOut });

      await withTenant(accountId, (tx) =>
        tx
          .update(payments)
          .set({ reservationId: reservation.id, status: "succeeded", updatedAt: new Date() })
          .where(eq(payments.id, payment.id)),
      );

      await db
        .update(webhookEvents)
        .set({ status: "processed", processedAt: new Date(), errorMessage: null, updatedAt: new Date() })
        .where(eq(webhookEvents.id, webhookEventId));

      return { accountId, reservationId: reservation.id };
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        // The dates are permanently gone — retrying changes nothing. Mark this payment
        // and webhook event failed, but don't rethrow: the job is done (no DLQ entry
        // for a deterministic outcome). The guest was never charged since capture is
        // manual and this phase never calls paymentIntents.capture().
        await withTenant(accountId, (tx) =>
          tx
            .update(payments)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(payments.id, payment.id)),
        );
        await db
          .update(webhookEvents)
          .set({ status: "failed", errorMessage: err.message, updatedAt: new Date() })
          .where(eq(webhookEvents.id, webhookEventId));
        return null;
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .update(webhookEvents)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(webhookEvents.id, webhookEventId));

    throw err instanceof ChannelSyncError ? err : new ChannelSyncError(`Stripe webhook processing failed: ${message}`);
  }
}
