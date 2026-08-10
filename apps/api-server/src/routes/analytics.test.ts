import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, properties, units, nightlyAvailability } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("GET /api/v1/host/analytics", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string };
  let ownerToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Analytics Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Analytics Test Tenant B" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    // 4-night window: 2 booked @ 10000, 1 available, 1 blocked -> availableNights = 4.
    await withTenant(account.id, (tx) =>
      tx.insert(nightlyAvailability).values([
        { accountId: account.id, unitId: unit.id, date: "2029-07-01", status: "booked", priceInCents: 10000 },
        { accountId: account.id, unitId: unit.id, date: "2029-07-02", status: "booked", priceInCents: 10000 },
        { accountId: account.id, unitId: unit.id, date: "2029-07-03", status: "available", priceInCents: 10000 },
        { accountId: account.id, unitId: unit.id, date: "2029-07-04", status: "blocked", priceInCents: null },
      ]),
    );

    // Belongs to a different tenant — must never leak into account's totals.
    const otherProperty = await withTenant(otherAccount.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: otherAccount.id, name: "Other Property" }).returning();
      return row!;
    });
    const otherUnit = await withTenant(otherAccount.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: otherAccount.id, propertyId: otherProperty.id, name: "Other Unit" }).returning();
      return row!;
    });
    await withTenant(otherAccount.id, (tx) =>
      tx.insert(nightlyAvailability).values([
        { accountId: otherAccount.id, unitId: otherUnit.id, date: "2029-07-01", status: "booked", priceInCents: 99999 },
      ]),
    );

    ownerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));

    await withTenant(otherAccount.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.accountId, otherAccount.id)));
    await withTenant(otherAccount.id, (tx) => tx.delete(units).where(eq(units.accountId, otherAccount.id)));
    await withTenant(otherAccount.id, (tx) => tx.delete(properties).where(eq(properties.accountId, otherAccount.id)));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("computes Occupancy Rate, ADR, and RevPAR for the requested window, scoped to the tenant", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/host/analytics?start=2029-07-01&end=2029-07-04",
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // bookedNights=2, availableNights=4, revenue=20000 -> occupancy=50%, ADR=10000, RevPAR=5000.
    expect(body.summary).toMatchObject({
      totalRoomRevenueInCents: 20000,
      bookedNights: 2,
      availableNights: 4,
      occupancyRate: 50,
      adrInCents: 10000,
      revParInCents: 5000,
    });
    expect(body.daily).toHaveLength(4);

    await app.close();
  }, 20000);

  it("returns 400 INVALID_DATE_RANGE when end precedes start", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/host/analytics?start=2029-07-04&end=2029-07-01",
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_DATE_RANGE");

    await app.close();
  }, 20000);
});
