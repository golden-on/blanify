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

describe.skipIf(!reachable)("Host routes", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string };
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Host Route Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Host Route Test Tenant B" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Unit" })
        .returning();
      return row!;
    });

    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("returns 401 without a token", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/host/units" });
    expect(response.statusCode).toBe(401);
    await app.close();
  }, 20000);

  it("lists only the authenticated tenant's units", async () => {
    const app = buildApp();

    const mine = await app.inject({ method: "GET", url: "/api/v1/host/units", headers: { authorization: `Bearer ${token}` } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().units).toHaveLength(1);
    expect(mine.json().units[0]).toMatchObject({ id: unit.id, propertyName: "Property" });

    const theirs = await app.inject({ method: "GET", url: "/api/v1/host/units", headers: { authorization: `Bearer ${otherToken}` } });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json().units).toEqual([]);

    await app.close();
  }, 20000);

  it("blocks and unblocks dates, reflected in the calendar endpoint", async () => {
    const app = buildApp();

    const blockResponse = await app.inject({
      method: "POST",
      url: `/api/v1/host/units/${unit.id}/block`,
      headers: { authorization: `Bearer ${token}` },
      payload: { dates: ["2030-01-10", "2030-01-11"] },
    });
    expect(blockResponse.statusCode).toBe(200);

    const calendarResponse = await app.inject({
      method: "GET",
      url: `/api/v1/host/units/${unit.id}/calendar?start=2030-01-01&end=2030-01-31`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(calendarResponse.statusCode).toBe(200);
    const nights = calendarResponse.json().nights as Array<{ date: string; status: string }>;
    expect(nights.find((n) => n.date === "2030-01-10")?.status).toBe("blocked");

    const unblockResponse = await app.inject({
      method: "POST",
      url: `/api/v1/host/units/${unit.id}/unblock`,
      headers: { authorization: `Bearer ${token}` },
      payload: { dates: ["2030-01-10", "2030-01-11"] },
    });
    expect(unblockResponse.statusCode).toBe(200);

    // A different tenant's token must never be able to block this unit's dates —
    // otherwise it could squat on another tenant's (unitId, date) pair.
    const crossTenantBlock = await app.inject({
      method: "POST",
      url: `/api/v1/host/units/${unit.id}/block`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { dates: ["2030-02-01"] },
    });
    expect(crossTenantBlock.statusCode).toBe(403);
    expect(crossTenantBlock.json().error.code).toBe("TENANT_ACCESS_DENIED");

    const crossTenantCalendar = await app.inject({
      method: "GET",
      url: `/api/v1/host/units/${unit.id}/calendar?start=2030-01-01&end=2030-01-31`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(crossTenantCalendar.statusCode).toBe(403);

    await app.close();
  }, 20000);
});
