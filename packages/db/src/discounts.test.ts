import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { createDiscount, evaluateDiscount } from "./discounts";
import { accounts } from "./schema/accounts";
import { discounts } from "./schema/discounts";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("discounts", () => {
  let account: { id: string };
  let otherAccount: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Discounts Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Discounts Test Tenant B" }).returning())[0]!;

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const nextYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    await createDiscount(account.id, {
      code: "SUMMER25",
      discountType: "percentage",
      value: 0.25,
      validFrom: yesterday.toISOString(),
      validTo: nextYear.toISOString(),
    });
    await createDiscount(account.id, {
      code: "FLAT50",
      discountType: "fixed_amount",
      value: 5000,
      validFrom: yesterday.toISOString(),
      validTo: nextYear.toISOString(),
    });
    await createDiscount(account.id, {
      code: "LONGSTAY",
      discountType: "percentage",
      value: 0.1,
      minStayNights: 7,
      validFrom: yesterday.toISOString(),
      validTo: nextYear.toISOString(),
    });
    await createDiscount(account.id, {
      code: "EXPIRED",
      discountType: "percentage",
      value: 0.5,
      validFrom: new Date(yesterday.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      validTo: yesterday.toISOString(),
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(discounts).where(eq(discounts.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("computes a percentage discount rounded and clamped to the nightly total", async () => {
    const result = await evaluateDiscount({ accountId: account.id, code: "summer25", nightlyTotalInCents: 10000, stayNights: 3 });
    expect(result).toMatchObject({ valid: true, discountInCents: 2500 });
  });

  it("clamps a fixed-amount discount so it never exceeds the nightly total", async () => {
    const result = await evaluateDiscount({ accountId: account.id, code: "FLAT50", nightlyTotalInCents: 3000, stayNights: 3 });
    expect(result).toMatchObject({ valid: true, discountInCents: 3000 });
  });

  it("rejects a stay shorter than the code's minStayNights", async () => {
    const result = await evaluateDiscount({ accountId: account.id, code: "LONGSTAY", nightlyTotalInCents: 10000, stayNights: 3 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/minimum stay/i);
  });

  it("rejects an expired code", async () => {
    const result = await evaluateDiscount({ accountId: account.id, code: "EXPIRED", nightlyTotalInCents: 10000, stayNights: 3 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/not valid/i);
  });

  it("rejects an unknown code with a clear message", async () => {
    const result = await evaluateDiscount({ accountId: account.id, code: "DOES-NOT-EXIST", nightlyTotalInCents: 10000, stayNights: 3 });
    expect(result).toEqual({ valid: false, reason: "Invalid promo code" });
  });

  it("never lets a second tenant evaluate the first tenant's code", async () => {
    const result = await evaluateDiscount({ accountId: otherAccount.id, code: "SUMMER25", nightlyTotalInCents: 10000, stayNights: 3 });
    expect(result).toEqual({ valid: false, reason: "Invalid promo code" });
  });
});
