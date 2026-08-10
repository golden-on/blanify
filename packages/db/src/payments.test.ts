import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { createReservation } from "./inventory";
import { recordPendingPayment, processStripeWebhookEvent } from "./payments";
import { accounts } from "./schema/accounts";
import { properties } from "./schema/properties";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { nightlyAvailability } from "./schema/nightly-availability";
import { webhookEvents } from "./schema/webhook-events";
import { payments } from "./schema/payments";
import { guestSessions } from "./schema/guest-sessions";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

function stripeCheckoutCompletedPayload(eventId: string, sessionId: string, paymentIntentId: string, metadata: unknown) {
  return {
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_intent: paymentIntentId,
        metadata,
      },
    },
  };
}

describe.skipIf(!reachable)("processStripeWebhookEvent", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Stripe Webhook Processing Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "Stripe Webhook Test Property" })
        .returning();
      return row!;
    });

    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Unit 1" })
        .returning();
      return row!;
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) =>
      tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    await withTenant(account.id, (tx) => tx.delete(payments).where(eq(payments.accountId, account.id)));
    // processStripeWebhookEvent now also mints a guest_sessions row on success (Phase
    // 10) — it has no RLS, so this is a plain delete, and it must happen before
    // reservations to satisfy guest_sessions' FK to reservations.
    await db.delete(guestSessions).where(eq(guestSessions.accountId, account.id));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db
      .delete(webhookEvents)
      .where(eq(webhookEvents.externalEventId, "evt-stripe-checkout-completed-1"));
    await db
      .delete(webhookEvents)
      .where(eq(webhookEvents.externalEventId, "evt-stripe-checkout-completed-conflict"));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("creates a reservation and marks the payment succeeded on checkout.session.completed", async () => {
    const paymentIntentId = "pi_test_success_1";
    await recordPendingPayment({
      accountId: account.id,
      stripePaymentIntentId: paymentIntentId,
      amountInCents: 20000,
      currency: "usd",
    });

    const [event] = await db
      .insert(webhookEvents)
      .values({
        channel: "stripe",
        externalEventId: "evt-stripe-checkout-completed-1",
        payload: stripeCheckoutCompletedPayload("evt-stripe-checkout-completed-1", "cs_test_success_1", paymentIntentId, {
          accountId: account.id,
          unitId: unit.id,
          checkIn: "2028-06-01",
          checkOut: "2028-06-03",
          subtotalInCents: "20000",
          taxInCents: "0",
          lineItemsJson: JSON.stringify([{ label: "Nightly rate", amountInCents: 20000 }]),
        }),
      })
      .returning();

    await processStripeWebhookEvent(event!.id);

    const nights = await withTenant(account.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    expect(nights.map((night) => night.date).sort()).toEqual(["2028-06-01", "2028-06-02"]);
    expect(nights.every((night) => night.status === "booked")).toBe(true);

    const payment = await withTenant(account.id, async (tx) => {
      const [row] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, paymentIntentId));
      return row;
    });
    expect(payment?.status).toBe("succeeded");
    expect(payment?.reservationId).toBeTruthy();

    const [updatedEvent] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, event!.id));
    expect(updatedEvent?.status).toBe("processed");
  }, 20000);

  it("marks the payment and webhook event failed without throwing when the dates are already booked", async () => {
    // Simulate the dates having already been booked by someone else before this
    // guest's Stripe webhook arrives.
    await createReservation({
      accountId: account.id,
      unitId: unit.id,
      checkIn: "2028-06-10",
      checkOut: "2028-06-12",
    });

    const paymentIntentId = "pi_test_conflict_1";
    await recordPendingPayment({
      accountId: account.id,
      stripePaymentIntentId: paymentIntentId,
      amountInCents: 20000,
      currency: "usd",
    });

    const [event] = await db
      .insert(webhookEvents)
      .values({
        channel: "stripe",
        externalEventId: "evt-stripe-checkout-completed-conflict",
        payload: stripeCheckoutCompletedPayload(
          "evt-stripe-checkout-completed-conflict",
          "cs_test_conflict_1",
          paymentIntentId,
          {
            accountId: account.id,
            unitId: unit.id,
            checkIn: "2028-06-10",
            checkOut: "2028-06-12",
            subtotalInCents: "20000",
            taxInCents: "0",
            lineItemsJson: JSON.stringify([{ label: "Nightly rate", amountInCents: 20000 }]),
          },
        ),
      })
      .returning();

    await expect(processStripeWebhookEvent(event!.id)).resolves.toBeNull();

    const payment = await withTenant(account.id, async (tx) => {
      const [row] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, paymentIntentId));
      return row;
    });
    expect(payment?.status).toBe("failed");
    expect(payment?.reservationId).toBeNull();

    const [updatedEvent] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, event!.id));
    expect(updatedEvent?.status).toBe("failed");
  }, 20000);
});
