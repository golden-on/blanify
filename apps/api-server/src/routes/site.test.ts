import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, hostedWebsites, websitePages } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("Site routes", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Site Route Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Site Route Test Tenant B" }).returning())[0]!;

    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "site-host@example.com", role: "owner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "site-other@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(websitePages).where(eq(websitePages.accountId, account.id)));
    await withTenant(otherAccount.id, (tx) => tx.delete(websitePages).where(eq(websitePages.accountId, otherAccount.id)));
    await withTenant(account.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, account.id)));
    await withTenant(otherAccount.id, (tx) => tx.delete(hostedWebsites).where(eq(hostedWebsites.accountId, otherAccount.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("auto-creates default site config on first GET and stays stable on a second GET", async () => {
    const app = buildApp();

    const first = await app.inject({ method: "GET", url: "/api/v1/host/site", headers: { authorization: `Bearer ${token}` } });
    expect(first.statusCode).toBe(200);
    const firstSite = first.json().site;
    expect(firstSite.slug).toMatch(/^[a-z0-9-]+$/);
    expect(firstSite.primaryColor).toBe("#0f172a");
    expect(firstSite.isPublished).toBe(false);
    expect(firstSite.featuredUnitIds).toEqual([]);

    const second = await app.inject({ method: "GET", url: "/api/v1/host/site", headers: { authorization: `Bearer ${token}` } });
    expect(second.statusCode).toBe(200);
    expect(second.json().site).toMatchObject({ id: firstSite.id, slug: firstSite.slug });

    await app.close();
  }, 20000);

  it("updates hero, theme, slug, domain, and publish state, and persists across a GET", async () => {
    const app = buildApp();

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/host/site",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        slug: "sunset-villas-test",
        customDomain: "www.sunsetvillas.example",
        primaryColor: "#ff5500",
        heroTitle: "Welcome to Sunset Villas",
        heroSubtitle: "Steps from the beach",
        isPublished: true,
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().site).toMatchObject({
      slug: "sunset-villas-test",
      customDomain: "www.sunsetvillas.example",
      primaryColor: "#ff5500",
      heroTitle: "Welcome to Sunset Villas",
      heroSubtitle: "Steps from the beach",
      isPublished: true,
    });

    const getResponse = await app.inject({ method: "GET", url: "/api/v1/host/site", headers: { authorization: `Bearer ${token}` } });
    expect(getResponse.json().site).toMatchObject({ slug: "sunset-villas-test", heroTitle: "Welcome to Sunset Villas" });

    await app.close();
  }, 20000);

  it("rejects a slug already taken by another tenant with 409 SLUG_TAKEN", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/host/site",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { slug: "sunset-villas-test" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SLUG_TAKEN");

    await app.close();
  }, 20000);

  it("isolates auto-created sites per tenant", async () => {
    const app = buildApp();

    const mine = await app.inject({ method: "GET", url: "/api/v1/host/site", headers: { authorization: `Bearer ${token}` } });
    const theirs = await app.inject({ method: "GET", url: "/api/v1/host/site", headers: { authorization: `Bearer ${otherToken}` } });

    expect(mine.json().site.id).not.toBe(theirs.json().site.id);
    expect(theirs.json().site.slug).not.toBe("sunset-villas-test");

    await app.close();
  }, 20000);
});
