import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, properties, units, unitAddOns } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("Add-on routes", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string };
  let ownerToken: string;
  let cleanerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Add-On Route Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Add-On Route Test Tenant B" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    ownerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    cleanerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "cleaner@example.com", role: "cleaner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(unitAddOns).where(eq(unitAddOns.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("creates, lists, and deletes an add-on, and rejects a cross-tenant unitId", async () => {
    const app = buildApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/host/add-ons",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { unitId: unit.id, name: "Early check-in", priceInCents: 2500, feeType: "per_stay" },
    });
    expect(createResponse.statusCode).toBe(201);
    const addOnId = createResponse.json().addOn.id as string;

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/host/add-ons?unitId=${unit.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listResponse.json().addOns.map((a: { id: string }) => a.id)).toContain(addOnId);

    const crossTenantCreate = await app.inject({
      method: "POST",
      url: "/api/v1/host/add-ons",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { unitId: unit.id, name: "Squatted add-on", priceInCents: 100, feeType: "per_stay" },
    });
    expect(crossTenantCreate.statusCode).toBe(403);
    expect(crossTenantCreate.json().error.code).toBe("TENANT_ACCESS_DENIED");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/host/add-ons/${addOnId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(deleteResponse.statusCode).toBe(204);

    await app.close();
  }, 20000);

  it("blocks a cleaner-role token from add-on routes", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/host/add-ons?unitId=${unit.id}`,
      headers: { authorization: `Bearer ${cleanerToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  }, 20000);
});
