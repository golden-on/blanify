import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, properties, units, reservations, nightlyAvailability, threads, createReservation } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

interface ChannelRevenueRow {
  channel: string;
  revenueInCents: number;
}

interface UnitComparisonRow {
  unitId: string;
  unitName: string;
  totalBookings: number;
  roomRevenueInCents: number;
  occupancyPercent: number;
  avgLeadTimeDays: number;
}

describe.skipIf(!reachable)("GET /api/v1/host/analytics (Phase 16 extensions)", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unitA: { id: string };
  let unitB: { id: string };
  let unitEmpty: { id: string };
  let token: string;
  let otherToken: string;

  const START = "2031-02-01";
  const END = "2031-02-28";

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Analytics Ext Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Analytics Ext Test Tenant B" }).returning())[0]!;
    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com", role: "owner" });

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    const insertedUnits = await withTenant(account.id, (tx) =>
      tx
        .insert(units)
        .values([
          { accountId: account.id, propertyId: property.id, name: "Unit A" },
          { accountId: account.id, propertyId: property.id, name: "Unit B" },
          { accountId: account.id, propertyId: property.id, name: "Unit Empty" },
        ])
        .returning(),
    );
    unitA = insertedUnits[0]!;
    unitB = insertedUnits[1]!;
    unitEmpty = insertedUnits[2]!;

    // Manual, host-entered airbnb-tagged booking on Unit A -> "airbnb" channel bucket.
    const airbnbReservation = await createReservation({
      accountId: account.id,
      unitId: unitA.id,
      checkIn: "2031-02-05",
      checkOut: "2031-02-07",
      guestName: "Airbnb Guest",
      channel: "airbnb",
      totalPriceInCents: 20000,
    });
    // Backdate createdAt so lead time (checkIn - createdAt) is deterministic: 10 days.
    await withTenant(account.id, (tx) =>
      tx.update(reservations).set({ createdAt: new Date("2031-01-26T00:00:00Z") }).where(eq(reservations.id, airbnbReservation.id)),
    );

    // Manual, host-entered walk-in booking (channel explicitly "direct") on Unit A -> "manual" bucket.
    const manualReservation = await createReservation({
      accountId: account.id,
      unitId: unitA.id,
      checkIn: "2031-02-10",
      checkOut: "2031-02-11",
      guestName: "Walk-in Guest",
      channel: "direct",
      totalPriceInCents: 10000,
    });
    await withTenant(account.id, (tx) =>
      tx.update(reservations).set({ createdAt: new Date("2031-02-08T00:00:00Z") }).where(eq(reservations.id, manualReservation.id)),
    );

    // Checkout-flow booking (no guestName -> no thread) on Unit B -> "direct" bucket.
    await createReservation({
      accountId: account.id,
      unitId: unitB.id,
      checkIn: "2031-02-15",
      checkOut: "2031-02-16",
      totalPriceInCents: 15000,
    });
  }, 30000);

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 30000);

  it("splits revenue into direct/airbnb/manual buckets and zeroes out unused channels", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/host/analytics?start=${START}&end=${END}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const channelRevenue = response.json().channelRevenue as ChannelRevenueRow[];
    const byChannel = Object.fromEntries(channelRevenue.map((c) => [c.channel, c.revenueInCents]));

    expect(byChannel.airbnb).toBe(20000);
    expect(byChannel.manual).toBe(10000);
    expect(byChannel.direct).toBe(15000);
    expect(byChannel.booking_com).toBe(0);
    expect(byChannel.ical).toBe(0);

    await app.close();
  }, 20000);

  it("computes the average booking lead time across reservations with checkIn in range", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/host/analytics?start=2031-02-01&end=2031-02-12`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    // Airbnb reservation: checkIn 2031-02-05, createdAt 2031-01-26 -> 10 days.
    // Manual reservation: checkIn 2031-02-10, createdAt 2031-02-08 -> 2 days.
    // Average: (10 + 2) / 2 = 6 days.
    expect(response.json().avgLeadTimeDays).toBe(6);

    await app.close();
  }, 20000);

  it("returns per-unit comparison rows including a zero-activity unit", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/host/analytics?start=${START}&end=${END}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const unitComparison = response.json().unitComparison as UnitComparisonRow[];

    const rowA = unitComparison.find((r) => r.unitId === unitA.id);
    expect(rowA).toMatchObject({ unitName: "Unit A", totalBookings: 2, roomRevenueInCents: 30000 });
    expect(rowA!.avgLeadTimeDays).toBeGreaterThan(0);

    const rowB = unitComparison.find((r) => r.unitId === unitB.id);
    expect(rowB).toMatchObject({ unitName: "Unit B", totalBookings: 1, roomRevenueInCents: 15000 });

    const rowEmpty = unitComparison.find((r) => r.unitId === unitEmpty.id);
    expect(rowEmpty).toMatchObject({
      unitName: "Unit Empty",
      totalBookings: 0,
      roomRevenueInCents: 0,
      occupancyPercent: 0,
      avgLeadTimeDays: 0,
    });

    await app.close();
  }, 20000);

  it("never leaks channel revenue or unit comparison data across tenants", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/host/analytics?start=${START}&end=${END}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect((body.channelRevenue as ChannelRevenueRow[]).every((c) => c.revenueInCents === 0)).toBe(true);
    expect(body.unitComparison).toEqual([]);
    expect(body.avgLeadTimeDays).toBe(0);

    await app.close();
  }, 20000);
});
