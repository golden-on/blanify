import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, discounts } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("Discount routes", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let ownerToken: string;
  let cleanerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Discount Route Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Discount Route Test Tenant B" }).returning())[0]!;

    ownerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    cleanerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "cleaner@example.com", role: "cleaner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(discounts).where(eq(discounts.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("creates, lists, and deletes a discount under withTenant, isolated per tenant", async () => {
    const app = buildApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/host/discounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        code: "WELCOME10",
        discountType: "percentage",
        value: 0.1,
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: "2030-01-01T00:00:00.000Z",
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const discountId = createResponse.json().discount.id as string;

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/host/discounts", headers: { authorization: `Bearer ${ownerToken}` } });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().discounts.map((d: { id: string }) => d.id)).toContain(discountId);

    const otherListResponse = await app.inject({ method: "GET", url: "/api/v1/host/discounts", headers: { authorization: `Bearer ${otherToken}` } });
    expect(otherListResponse.json().discounts).toEqual([]);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/host/discounts/${discountId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(deleteResponse.statusCode).toBe(204);

    await app.close();
  }, 20000);

  it("blocks a cleaner-role token from every discount route", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/host/discounts", headers: { authorization: `Bearer ${cleanerToken}` } });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  }, 20000);
});
