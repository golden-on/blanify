import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantAccessError } from "@repo/shared-types";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { bulkUpdateNightlyRates } from "./pricing";
import { accounts } from "./schema/accounts";
import { properties } from "./schema/properties";
import { units } from "./schema/units";
import { nightlyAvailability } from "./schema/nightly-availability";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("bulkUpdateNightlyRates", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string };
  let otherUnit: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Pricing Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Pricing Test Tenant B" }).returning())[0]!;

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

    const otherProperty = await withTenant(otherAccount.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: otherAccount.id, name: "Other Property" })
        .returning();
      return row!;
    });
    otherUnit = await withTenant(otherAccount.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: otherAccount.id, propertyId: otherProperty.id, name: "Other Unit" })
        .returning();
      return row!;
    });

    // Pre-seed one existing night with no price, to prove the bulk update modifies it
    // rather than only creating missing rows.
    await withTenant(account.id, (tx) =>
      tx.insert(nightlyAvailability).values({ accountId: account.id, unitId: unit.id, date: "2027-03-01", status: "available" }),
    );
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) =>
      tx.delete(properties).where(eq(properties.accountId, account.id)),
    );
    await withTenant(otherAccount.id, (tx) => tx.delete(units).where(eq(units.id, otherUnit.id)));
    await withTenant(otherAccount.id, (tx) =>
      tx.delete(properties).where(eq(properties.accountId, otherAccount.id)),
    );
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("updates an existing night's price and creates a missing night with the requested price", async () => {
    const updatedCount = await bulkUpdateNightlyRates(account.id, [
      { unitId: unit.id, date: "2027-03-01", priceInCents: 15000 },
      { unitId: unit.id, date: "2027-03-02", priceInCents: 20000 },
    ]);

    expect(updatedCount).toBe(2);

    const rows = await withTenant(account.id, (tx) =>
      tx
        .select()
        .from(nightlyAvailability)
        .where(and(eq(nightlyAvailability.unitId, unit.id))),
    );

    const march1 = rows.find((r) => r.date === "2027-03-01");
    const march2 = rows.find((r) => r.date === "2027-03-02");
    expect(march1?.priceInCents).toBe(15000);
    expect(march2?.priceInCents).toBe(20000);
    expect(march2?.status).toBe("available");
  }, 20000);

  it("never lets a second tenant's RLS-scoped read see the first tenant's nightly_availability rows", async () => {
    const otherTenantRows = await withTenant(otherAccount.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    expect(otherTenantRows).toEqual([]);
  }, 20000);

  it("throws TenantAccessError when a unitId does not belong to the authenticated tenant", async () => {
    await expect(
      bulkUpdateNightlyRates(account.id, [{ unitId: otherUnit.id, date: "2027-03-01", priceInCents: 1000 }]),
    ).rejects.toBeInstanceOf(TenantAccessError);
  }, 20000);
});
