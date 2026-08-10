import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { createTaxRule, getApplicableTaxRules, computeTaxForRules } from "./tax-rules";
import { accounts } from "./schema/accounts";
import { properties } from "./schema/properties";
import { units } from "./schema/units";
import { taxRules } from "./schema/tax-rules";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("tax rules", () => {
  let account: { id: string };
  let unitA: { id: string };
  let unitB: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Tax Rules Test Tenant" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unitA = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit A" }).returning();
      return row!;
    });
    unitB = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit B" }).returning();
      return row!;
    });

    await createTaxRule(account.id, { jurisdiction: "State", taxType: "sales_tax", rateType: "percentage", rateValue: 0.07 });
    await createTaxRule(account.id, { jurisdiction: "City", taxType: "tourist_tax", rateType: "per_night_flat", rateValue: 300, appliesToUnitId: unitA.id });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(taxRules).where(eq(taxRules.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("returns both the account-wide rule and the unit-scoped rule for the matching unit", async () => {
    const rules = await getApplicableTaxRules(account.id, unitA.id);
    expect(rules).toHaveLength(2);
  });

  it("returns only the account-wide rule for a unit the scoped rule doesn't apply to", async () => {
    const rules = await getApplicableTaxRules(account.id, unitB.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ rateType: "percentage" });
  });

  it("computes a percentage tax rounded against the taxable base", () => {
    const result = computeTaxForRules(
      [{ id: "r1", jurisdiction: "State", taxType: "sales_tax", rateType: "percentage", rateValue: "0.07" } as never],
      10000,
      2,
    );
    expect(result).toEqual({ taxInCents: 700, lineItems: [expect.objectContaining({ amountInCents: 700 })] });
  });

  it("scales a per-night-flat tax by the number of stay nights", () => {
    const result = computeTaxForRules(
      [{ id: "r2", jurisdiction: "City", taxType: "tourist_tax", rateType: "per_night_flat", rateValue: "300" } as never],
      10000,
      3,
    );
    expect(result).toEqual({ taxInCents: 900, lineItems: [expect.objectContaining({ amountInCents: 900 })] });
  });

  it("sums multiple applicable rules", async () => {
    const rules = await getApplicableTaxRules(account.id, unitA.id);
    const result = computeTaxForRules(rules, 10000, 2);
    // 7% of 10000 = 700, plus 300/night * 2 nights = 600 -> 1300.
    expect(result.taxInCents).toBe(1300);
    expect(result.lineItems).toHaveLength(2);
  });
});
