import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, webhookEvents } from "@repo/db";
import { stripeWebhookQueue } from "@repo/queue";
import { buildApp } from "../app";
import { stripe } from "../stripe-client";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

function signedPayload(payload: object) {
  const rawBody = JSON.stringify(payload);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return { rawBody, signature };
}

async function cleanupEvent(externalEventId: string) {
  const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.externalEventId, externalEventId));
  if (event) {
    const jobs = await stripeWebhookQueue.getJobs(["waiting", "delayed", "active", "failed"]);
    const job = jobs.find((j) => j.data.webhookEventId === event.id);
    await job?.remove();
  }
  await db.delete(webhookEvents).where(eq(webhookEvents.externalEventId, externalEventId));
}

describe.skipIf(!reachable)("POST /api/v1/webhooks/stripe", () => {
  const completedEventId = "evt_stripe_route_test_completed";
  const ignoredEventId = "evt_stripe_route_test_ignored";

  afterAll(async () => {
    await cleanupEvent(completedEventId);
    await cleanupEvent(ignoredEventId);
  });

  it("rejects a request with an invalid signature before recording anything", async () => {
    const app = buildApp();
    const payload = {
      id: "evt_stripe_route_test_forged",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_forged", payment_intent: "pi_forged", metadata: {} } },
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=not-a-real-signature" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_SIGNATURE");

    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.externalEventId, "evt_stripe_route_test_forged"));
    expect(event).toBeUndefined();

    await app.close();
  });

  it("accepts a new checkout.session.completed event and ignores a duplicate with the same id", async () => {
    const app = buildApp();
    const payload = {
      id: completedEventId,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_stripe_route_test",
          payment_intent: "pi_stripe_route_test",
          metadata: { accountId: "00000000-0000-0000-0000-000000000000", unitId: "00000000-0000-0000-0000-000000000000", checkIn: "2028-01-01", checkOut: "2028-01-02" },
        },
      },
    };
    const { rawBody, signature } = signedPayload(payload);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      payload: rawBody,
      headers: { "content-type": "application/json", "stripe-signature": signature },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: "accepted" });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      payload: rawBody,
      headers: { "content-type": "application/json", "stripe-signature": signature },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "duplicate" });

    await app.close();
  });

  it("records but does not enqueue event types other than checkout.session.completed", async () => {
    const app = buildApp();
    const payload = {
      id: ignoredEventId,
      object: "event",
      type: "payment_intent.created",
      data: { object: { id: "pi_stripe_route_test_ignored" } },
    };
    const { rawBody, signature } = signedPayload(payload);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      payload: rawBody,
      headers: { "content-type": "application/json", "stripe-signature": signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored" });

    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.externalEventId, ignoredEventId));
    expect(event).toBeDefined();

    await app.close();
  });
});
