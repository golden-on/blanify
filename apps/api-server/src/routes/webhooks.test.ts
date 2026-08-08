import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, webhookEvents } from "@repo/db";
import { signHmac } from "@repo/channel-sync";
import { otaWebhookQueue } from "@repo/queue";
import { buildApp } from "../app";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("POST /api/v1/webhooks/:channel", () => {
  const eventId = "webhook-route-test-event-1";

  afterAll(async () => {
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.externalEventId, eventId));
    if (event) {
      const jobs = await otaWebhookQueue.getJobs(["waiting", "delayed", "active", "failed"]);
      const job = jobs.find((j) => j.data.webhookEventId === event.id);
      await job?.remove();
    }
    await db.delete(webhookEvents).where(eq(webhookEvents.externalEventId, eventId));
  });

  it("accepts a new event and ignores a duplicate with the same external event id", async () => {
    const secret = process.env.AIRBNB_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("AIRBNB_WEBHOOK_SECRET must be set to run this test");
    }

    const app = buildApp();

    const payload = {
      eventId,
      eventType: "reservation.created",
      externalPropertyId: "ext-property-route-test",
      externalRoomId: "ext-room-route-test",
      checkIn: "2027-08-01",
      checkOut: "2027-08-03",
    };
    const rawBody = JSON.stringify(payload);
    const signature = signHmac(rawBody, secret);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/airbnb",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-airbnb-signature": signature },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: "accepted" });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/airbnb",
      payload: rawBody,
      headers: { "content-type": "application/json", "x-airbnb-signature": signature },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "duplicate" });

    await app.close();
  });

  it("rejects a request with an invalid signature before recording anything", async () => {
    const app = buildApp();

    const payload = {
      eventId: "webhook-route-test-bad-signature",
      eventType: "reservation.created",
      externalPropertyId: "ext-property-route-test",
      externalRoomId: "ext-room-route-test",
      checkIn: "2027-08-01",
      checkOut: "2027-08-03",
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/airbnb",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json", "x-airbnb-signature": "not-a-real-signature" },
    });

    expect(response.statusCode).toBe(401);

    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.externalEventId, "webhook-route-test-bad-signature"));
    expect(event).toBeUndefined();

    await app.close();
  });
});
