import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, pricingIntegrations } from "@repo/db";
import { pricingSyncQueue } from "@repo/queue";
import { buildApp } from "../app";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

async function cleanupJobsFor(accountId: string) {
  const jobs = await pricingSyncQueue.getJobs(["waiting", "delayed", "active", "completed", "failed"]);
  const matches = jobs.filter((job) => job.data.accountId === accountId);
  await Promise.all(matches.map((job) => job.remove()));
  return matches;
}

describe.skipIf(!reachable)("POST /api/v1/webhooks/pricing/:provider/:accountId", () => {
  let account: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Pricing Webhook Test Tenant" }).returning())[0]!;

    await withTenant(account.id, (tx) =>
      tx.insert(pricingIntegrations).values({
        accountId: account.id,
        provider: "pricelabs",
        apiKey: "test-pricelabs-key",
        isActive: true,
      }),
    );
  });

  afterAll(async () => {
    await cleanupJobsFor(account.id);
    await withTenant(account.id, (tx) => tx.delete(pricingIntegrations).where(eq(pricingIntegrations.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("enqueues a pricing-sync job and returns 202 for a valid API key", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/pricing/pricelabs/${account.id}`,
      headers: { authorization: "Bearer test-pricelabs-key", "content-type": "application/json" },
      payload: JSON.stringify([{ unitId: "00000000-0000-0000-0000-000000000000", date: "2027-08-01", priceInCents: 12000 }]),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "accepted" });

    const matches = await cleanupJobsFor(account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.data.updates).toEqual([
      { unitId: "00000000-0000-0000-0000-000000000000", date: "2027-08-01", priceInCents: 12000 },
    ]);

    await app.close();
  }, 20000);

  it("rejects a request with the wrong API key", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/pricing/pricelabs/${account.id}`,
      headers: { authorization: "Bearer wrong-key", "content-type": "application/json" },
      payload: JSON.stringify([{ unitId: "00000000-0000-0000-0000-000000000000", date: "2027-08-01", priceInCents: 12000 }]),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_API_KEY");

    await app.close();
  }, 20000);

  it("rejects a request missing the Authorization header", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/pricing/pricelabs/${account.id}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ unitId: "00000000-0000-0000-0000-000000000000", date: "2027-08-01", priceInCents: 12000 }]),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("MISSING_API_KEY");

    await app.close();
  }, 20000);

  it("rejects an empty payload array", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/pricing/pricelabs/${account.id}`,
      headers: { authorization: "Bearer test-pricelabs-key", "content-type": "application/json" },
      payload: JSON.stringify([]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PAYLOAD");

    await app.close();
  }, 20000);
});
