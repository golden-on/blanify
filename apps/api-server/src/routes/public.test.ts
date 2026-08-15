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
  // hosted_websites.accountId is unique (one site per account, Phase 14) — this suite
  // tests three distinct domain-resolution scenarios, so each gets its own account
  // rather than sharing one account across three sites.
  let subdomainAccount: { id: string };
  let customDomainAccount: { id: string };
  let unpublishedAccount: { id: string };
  let publishedSubdomainSite: { id: string };
  let publishedCustomDomainSite: { id: string };

  beforeAll(async () => {
    subdomainAccount = (await db.insert(accounts).values({ name: "Public Routes Test Tenant (subdomain)" }).returning())[0]!;
    customDomainAccount = (await db.insert(accounts).values({ name: "Public Routes Test Tenant (custom domain)" }).returning())[0]!;
    unpublishedAccount = (await db.insert(accounts).values({ name: "Public Routes Test Tenant (unpublished)" }).returning())[0]!;

    publishedSubdomainSite = await withTenant(subdomainAccount.id, async (tx) => {
      const [row] = await tx
        .insert(hostedWebsites)
        .values({
          accountId: subdomainAccount.id,
          subdomain: "public-routes-test-subdomain",
          themeConfig: { primaryColor: "#111111", fontFamily: "Inter" },
          isPublished: true,
        })
        .returning();
      return row!;
    });

    publishedCustomDomainSite = await withTenant(customDomainAccount.id, async (tx) => {
      const [row] = await tx
        .insert(hostedWebsites)
        .values({
          accountId: customDomainAccount.id,
          subdomain: "public-routes-test-subdomain-2",
          customDomain: "public-routes-test.example.com",
          themeConfig: { primaryColor: "#222222", fontFamily: "Inter" },
          isPublished: true,
        })
        .returning();
      return row!;
    });

    await withTenant(unpublishedAccount.id, (tx) =>
      tx.insert(hostedWebsites).values({
        accountId: unpublishedAccount.id,
        subdomain: "public-routes-test-subdomain-3",
        themeConfig: { primaryColor: "#333333", fontFamily: "Inter" },
        isPublished: false,
      }),
    );

    await withTenant(subdomainAccount.id, (tx) =>
      tx.insert(websitePages).values({
        accountId: subdomainAccount.id,
        websiteId: publishedSubdomainSite.id,
        slug: "/",
        layoutSchema: [{ type: "hero", title: "Welcome" }],
        isPublished: true,
      }),
    );
    await withTenant(customDomainAccount.id, (tx) =>
      tx.insert(websitePages).values({
        accountId: customDomainAccount.id,
        websiteId: publishedCustomDomainSite.id,
        slug: "/",
        layoutSchema: [{ type: "hero", title: "Welcome 2" }],
        isPublished: true,
      }),
    );
  });

  afterAll(async () => {
    await withTenant(subdomainAccount.id, (tx) => tx.delete(websitePages).where(eq(websitePages.accountId, subdomainAccount.id)));
    await withTenant(customDomainAccount.id, (tx) => tx.delete(websitePages).where(eq(websitePages.accountId, customDomainAccount.id)));
    await withTenant(subdomainAccount.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, subdomainAccount.id)));
    await withTenant(customDomainAccount.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, customDomainAccount.id)));
    await withTenant(unpublishedAccount.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, unpublishedAccount.id)));
    await db.delete(accounts).where(eq(accounts.id, subdomainAccount.id));
    await db.delete(accounts).where(eq(accounts.id, customDomainAccount.id));
    await db.delete(accounts).where(eq(accounts.id, unpublishedAccount.id));
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
