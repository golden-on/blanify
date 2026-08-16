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
  threads,
  stripeAccounts,
  taxRules,
  hostedWebsites,
  websitePages,
  unitIcalFeeds,
  createReservation,
  createTaxRule,
} from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!reachable)("GET /api/v1/host/dashboard", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string; propertyId: string };
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Dashboard Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Dashboard Test Tenant B" }).returning())[0]!;

    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(unitIcalFeeds).where(eq(unitIcalFeeds.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(websitePages).where(eq(websitePages.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(taxRules).where(eq(taxRules.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(stripeAccounts).where(eq(stripeAccounts.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 30000);

  it("returns an all-incomplete checklist and empty activity for a brand-new tenant", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/api/v1/host/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.checklist).toEqual({
      hasUnits: false,
      hasStripeConnected: false,
      hasTaxRules: false,
      hasWebsitePublished: false,
      hasChannelsConnected: false,
    });
    expect(body.today).toEqual({ checkIns: [], checkOuts: [], currentlyStaying: [] });
    expect(body.kpis.activeReservationsCount).toBe(0);
    expect(body.kpis.openThreadsCount).toBe(0);

    await app.close();
  }, 20000);

  it("flips each checklist flag on as the corresponding setup step is completed", async () => {
    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });
    await withTenant(account.id, (tx) => tx.insert(stripeAccounts).values({ accountId: account.id, stripeAccountId: "acct_dashboard_test" }));
    await createTaxRule(account.id, { jurisdiction: "California", taxType: "sales_tax", rateType: "percentage", rateValue: 0.08 });
    const website = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(hostedWebsites)
        .values({ accountId: account.id, subdomain: "dashboard-test-tenant", themeConfig: { primaryColor: "#000000", fontFamily: "Inter" }, isPublished: true })
        .returning();
      return row!;
    });
    await withTenant(account.id, (tx) =>
      tx.insert(websitePages).values({ accountId: account.id, websiteId: website.id, slug: "/", layoutSchema: [], isPublished: true }),
    );
    await withTenant(account.id, (tx) =>
      tx.insert(unitIcalFeeds).values({ accountId: account.id, unitId: unit.id, name: "Airbnb export", url: "https://example.com/feed.ics" }),
    );

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/host/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().checklist).toEqual({
      hasUnits: true,
      hasStripeConnected: true,
      hasTaxRules: true,
      hasWebsitePublished: true,
      hasChannelsConnected: true,
    });

    await app.close();
  }, 20000);

  it("buckets today's arrivals, departures, and in-house guests into the correct lists with no overlap", async () => {
    // Three separate units — each reservation books night `TODAY` (arriving and staying)
    // or is adjacent to it, so they'd conflict as double-bookings on a single shared unit.
    const [unitDeparting, unitStaying] = await withTenant(account.id, (tx) =>
      tx
        .insert(units)
        .values([
          { accountId: account.id, propertyId: unit.propertyId, name: "Unit Departing" },
          { accountId: account.id, propertyId: unit.propertyId, name: "Unit Staying" },
        ])
        .returning(),
    );

    const arriving = await createReservation({
      accountId: account.id,
      unitId: unit.id,
      checkIn: TODAY,
      checkOut: addDays(TODAY, 2),
      guestName: "Arriving Guest",
      channel: "direct",
    });
    const departing = await createReservation({
      accountId: account.id,
      unitId: unitDeparting!.id,
      checkIn: addDays(TODAY, -3),
      checkOut: TODAY,
      guestName: "Departing Guest",
      channel: "direct",
    });
    const staying = await createReservation({
      accountId: account.id,
      unitId: unitStaying!.id,
      checkIn: addDays(TODAY, -1),
      checkOut: addDays(TODAY, 1),
      guestName: "In-house Guest",
      channel: "direct",
    });

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/host/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const { today, kpis } = response.json();

    expect(today.checkIns.map((r: { id: string }) => r.id)).toEqual([arriving.id]);
    expect(today.checkOuts.map((r: { id: string }) => r.id)).toEqual([departing.id]);
    expect(today.currentlyStaying.map((r: { id: string }) => r.id)).toEqual([staying.id]);

    expect(today.checkIns[0]).toMatchObject({ guestName: "Arriving Guest", unitName: "Unit" });

    expect(kpis.activeReservationsCount).toBe(3);
    expect(kpis.openThreadsCount).toBe(3);

    await app.close();
  }, 20000);

  it("isolates dashboard data per tenant", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/api/v1/host/dashboard", headers: { authorization: `Bearer ${otherToken}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.checklist).toEqual({
      hasUnits: false,
      hasStripeConnected: false,
      hasTaxRules: false,
      hasWebsitePublished: false,
      hasChannelsConnected: false,
    });
    expect(body.today).toEqual({ checkIns: [], checkOuts: [], currentlyStaying: [] });
    expect(body.kpis.activeReservationsCount).toBe(0);

    await app.close();
  }, 20000);

  it("returns 401 without a token", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/host/dashboard" });
    expect(response.statusCode).toBe(401);
    await app.close();
  }, 20000);
});
