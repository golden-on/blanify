import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, properties, units, nightlyAvailability } from "@repo/db";
import { GoogleVacationRentalsDriver } from "./google-vacation-rentals";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("GoogleVacationRentalsDriver", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };
  const driver = new GoogleVacationRentalsDriver({ feedEndpointUrl: "https://feeds.example.com", apiKey: "test-key" });

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Google VR Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "Ocean View House", address: "1 Beach Rd" })
        .returning();
      return row!;
    });

    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Suite A", checkInInstructions: "Key is under the mat." })
        .returning();
      return row!;
    });

    await withTenant(account.id, (tx) =>
      tx.insert(nightlyAvailability).values([
        { accountId: account.id, unitId: unit.id, date: "2027-06-01", status: "available", priceInCents: 12000 },
        { accountId: account.id, unitId: unit.id, date: "2027-06-02", status: "blocked", priceInCents: 12000 },
        { accountId: account.id, unitId: unit.id, date: "2027-06-03", status: "available", priceInCents: null },
      ]),
    );
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  });

  it("formats the listing feed from real property/unit data", async () => {
    const listing = await driver.formatListingFeed(account.id, unit.id);
    expect(listing).toEqual({
      propertyId: unit.id,
      title: "Ocean View House - Suite A",
      address: "1 Beach Rd",
      description: "Key is under the mat.",
    });
  });

  it("formats the availability matrix, mapping status to a boolean", async () => {
    const matrix = await driver.formatAvailabilityMatrix(account.id, unit.id, "2027-06-01", "2027-06-03");
    expect(matrix.sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: "2027-06-01", available: true },
      { date: "2027-06-02", available: false },
      { date: "2027-06-03", available: true },
    ]);
  });

  it("formats the pricing feed, skipping nights with no price configured", async () => {
    const pricing = await driver.formatPricingFeed(account.id, unit.id, "2027-06-01", "2027-06-03");
    expect(pricing.sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: "2027-06-01", priceInCents: 12000 },
      { date: "2027-06-02", priceInCents: 12000 },
    ]);
  });

  it("fetchBookings returns an empty array — Google VR bookings arrive via the OTA webhook, not a pull API", async () => {
    await expect(driver.fetchBookings(account.id, unit.id)).resolves.toEqual([]);
  });
});
