import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, properties, units, unitIcalFeeds } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("Channel routes", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string };
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Channel Route Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Channel Route Test Tenant B" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "channel-host@example.com", role: "owner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "channel-other@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(unitIcalFeeds).where(eq(unitIcalFeeds.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("returns all four channels not_connected and no feeds for a fresh tenant", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/api/v1/host/channels", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { channels: { channel: string; status: string }[]; icalFeeds: unknown[] };
    expect(body.channels).toHaveLength(4);
    expect(body.channels.map((c) => c.channel).sort()).toEqual(["airbnb", "booking", "google_vacation_rentals", "ical"]);
    expect(body.channels.every((c) => c.status === "not_connected")).toBe(true);
    expect(body.icalFeeds).toEqual([]);

    await app.close();
  }, 20000);

  it("creates an iCal feed, rejects a cross-tenant unitId, syncs it, then deletes it", async () => {
    const app = buildApp();

    const crossTenant = await app.inject({
      method: "POST",
      url: "/api/v1/host/channels/ical-feeds",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { unitId: unit.id, name: "Squatter feed", url: "https://example.com/squat.ics" },
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.json().error.code).toBe("TENANT_ACCESS_DENIED");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/host/channels/ical-feeds",
      headers: { authorization: `Bearer ${token}` },
      payload: { unitId: unit.id, name: "Airbnb export", url: "https://example.com/airbnb.ics" },
    });
    expect(createResponse.statusCode).toBe(201);
    const feedId = createResponse.json().feed.id as string;

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/host/channels", headers: { authorization: `Bearer ${token}` } });
    expect(listResponse.json().icalFeeds).toContainEqual(expect.objectContaining({ id: feedId, unitName: "Unit" }));

    const syncResponse = await app.inject({ method: "POST", url: "/api/v1/host/channels/sync", headers: { authorization: `Bearer ${token}` } });
    expect(syncResponse.statusCode).toBe(202);
    expect(syncResponse.json()).toMatchObject({ status: "accepted", queued: 1 });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/host/channels/ical-feeds/${feedId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteResponse.statusCode).toBe(204);

    const finalList = await app.inject({ method: "GET", url: "/api/v1/host/channels", headers: { authorization: `Bearer ${token}` } });
    expect(finalList.json().icalFeeds).toEqual([]);

    await app.close();
  }, 20000);

  it("returns 202 from sync without throwing when there are zero feeds to queue", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "POST", url: "/api/v1/host/channels/sync", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "accepted", queued: 0 });

    await app.close();
  }, 20000);
});
