import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  reservations,
  nightlyAvailability,
  channelConnections,
  channelUnitMappings,
  webhookEvents,
} from "@repo/db";
import { processOtaWebhookEvent } from "./process";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("OTA webhook processing", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };
  let connection: { id: string };
  let mapping: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "OTA Webhook Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "OTA Webhook Test Property" })
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

    connection = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(channelConnections)
        .values({ accountId: account.id, channel: "airbnb", accessToken: "test-token" })
        .returning();
      return row!;
    });

    mapping = await db
      .insert(channelUnitMappings)
      .values({
        accountId: account.id,
        unitId: unit.id,
        channelConnectionId: connection.id,
        externalPropertyId: "ext-property-1",
        externalRoomId: "ext-room-1",
      })
      .returning()
      .then((rows) => rows[0]!);
  });

  afterAll(async () => {
    await db.delete(webhookEvents).where(eq(webhookEvents.externalEventId, "evt-reservation-created-1"));
    await db.delete(channelUnitMappings).where(eq(channelUnitMappings.id, mapping.id));
    await withTenant(account.id, (tx) =>
      tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(channelConnections).where(eq(channelConnections.id, connection.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  });

  it("locks the target dates on nightly_availability for a reservation.created event", async () => {
    const [event] = await db
      .insert(webhookEvents)
      .values({
        channel: "airbnb",
        externalEventId: "evt-reservation-created-1",
        payload: {
          eventId: "evt-reservation-created-1",
          eventType: "reservation.created",
          externalPropertyId: "ext-property-1",
          externalRoomId: "ext-room-1",
          checkIn: "2027-07-01",
          checkOut: "2027-07-04",
        },
      })
      .returning();

    await processOtaWebhookEvent(event!.id);

    const rows = await withTenant(account.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    const dates = rows.map((row) => row.date).sort();

    expect(dates).toEqual(["2027-07-01", "2027-07-02", "2027-07-03"]);
    expect(rows.every((row) => row.status === "booked")).toBe(true);

    const [updatedEvent] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, event!.id));
    expect(updatedEvent?.status).toBe("processed");
  });
});
