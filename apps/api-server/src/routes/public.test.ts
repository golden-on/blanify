import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  nightlyAvailability,
  hostedWebsites,
  websitePages,
  ensureNightlyAvailability,
} from "@repo/db";
import { buildApp } from "../app";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("GET /api/v1/public/websites/resolve", () => {
  let account: { id: string };
  let publishedSubdomainSite: { id: string };
  let publishedCustomDomainSite: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Public Routes Test Tenant" }).returning())[0]!;

    publishedSubdomainSite = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(hostedWebsites)
        .values({
          accountId: account.id,
          subdomain: "public-routes-test-subdomain",
          themeConfig: { primaryColor: "#111111", fontFamily: "Inter" },
          isPublished: true,
        })
        .returning();
      return row!;
    });

    publishedCustomDomainSite = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(hostedWebsites)
        .values({
          accountId: account.id,
          subdomain: "public-routes-test-subdomain-2",
          customDomain: "public-routes-test.example.com",
          themeConfig: { primaryColor: "#222222", fontFamily: "Inter" },
          isPublished: true,
        })
        .returning();
      return row!;
    });

    await withTenant(account.id, (tx) =>
      tx.insert(hostedWebsites).values({
        accountId: account.id,
        subdomain: "public-routes-test-subdomain-3",
        themeConfig: { primaryColor: "#333333", fontFamily: "Inter" },
        isPublished: false,
      }),
    );

    await withTenant(account.id, (tx) =>
      tx.insert(websitePages).values([
        {
          accountId: account.id,
          websiteId: publishedSubdomainSite.id,
          slug: "/",
          layoutSchema: [{ type: "hero", title: "Welcome" }],
          isPublished: true,
        },
        {
          accountId: account.id,
          websiteId: publishedCustomDomainSite.id,
          slug: "/",
          layoutSchema: [{ type: "hero", title: "Welcome 2" }],
          isPublished: true,
        },
      ]),
    );
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(websitePages).where(eq(websitePages.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  });

  it("resolves a published site by subdomain", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/websites/resolve?domain=public-routes-test-subdomain&path=/",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.website.id).toBe(publishedSubdomainSite.id);
    expect(body.page.layoutSchema).toEqual([{ type: "hero", title: "Welcome" }]);
    await app.close();
  });

  it("resolves a published site by custom domain", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/websites/resolve?domain=public-routes-test.example.com&path=/",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().website.id).toBe(publishedCustomDomainSite.id);
    await app.close();
  });

  it("returns 404 for an unpublished site's domain, proving the RLS policy hides it", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/websites/resolve?domain=public-routes-test-subdomain-3&path=/",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("WEBSITE_NOT_FOUND");
    await app.close();
  });

  it("returns 404 for a domain with no matching website at all", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/websites/resolve?domain=does-not-exist.example.com&path=/",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe.skipIf(!reachable)("GET /api/v1/public/units/:unitId/availability", () => {
  let accountA: { id: string };
  let accountB: { id: string };
  let property: { id: string };
  let unit: { id: string };

  beforeAll(async () => {
    accountA = (await db.insert(accounts).values({ name: "Public Availability Test Tenant A" }).returning())[0]!;
    accountB = (await db.insert(accounts).values({ name: "Public Availability Test Tenant B" }).returning())[0]!;

    property = await withTenant(accountA.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: accountA.id, name: "Public Availability Test Property" })
        .returning();
      return row!;
    });

    unit = await withTenant(accountA.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: accountA.id, propertyId: property.id, name: "Unit 1" })
        .returning();
      return row!;
    });

    await ensureNightlyAvailability(accountA.id, unit.id, ["2028-01-01", "2028-01-02"], 12000);
  });

  afterAll(async () => {
    await withTenant(accountA.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(accountA.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(accountA.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, accountA.id));
    await db.delete(accounts).where(eq(accounts.id, accountB.id));
  });

  it("returns nights for the correct account", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/units/${unit.id}/availability?start=2028-01-01&end=2028-01-02&accountId=${accountA.id}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nights).toHaveLength(2);
    expect(body.nights[0]).toMatchObject({ date: "2028-01-01", status: "available", priceInCents: 12000 });
    await app.close();
  });

  it("returns no nights when queried under a different tenant's accountId", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/units/${unit.id}/availability?start=2028-01-01&end=2028-01-02&accountId=${accountB.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().nights).toEqual([]);
    await app.close();
  });
});
