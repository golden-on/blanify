import { and, eq, sql } from "drizzle-orm";
import { TenantAccessError } from "@repo/shared-types";
import type { PricingProvider, PricingRateUpdate } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { ensureNightlyAvailability } from "./inventory";
import { pricingIntegrations } from "./schema/pricing-integrations";
import { units } from "./schema/units";

export async function getActivePricingIntegration(accountId: string, provider: PricingProvider) {
  return withTenant(accountId, async (tx) => {
    const [row] = await tx
      .select()
      .from(pricingIntegrations)
      .where(and(eq(pricingIntegrations.provider, provider), eq(pricingIntegrations.isActive, true)));
    return row;
  });
}

function groupByUnit(updates: PricingRateUpdate[]): Map<string, PricingRateUpdate[]> {
  const grouped = new Map<string, PricingRateUpdate[]>();
  for (const update of updates) {
    const existing = grouped.get(update.unitId);
    if (existing) {
      existing.push(update);
    } else {
      grouped.set(update.unitId, [update]);
    }
  }
  return grouped;
}

export async function bulkUpdateNightlyRates(accountId: string, updates: PricingRateUpdate[]): Promise<number> {
  if (updates.length === 0) return 0;

  const byUnit = groupByUnit(updates);
  let updatedCount = 0;

  for (const [unitId, unitUpdates] of byUnit) {
    const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
    if (!unit) {
      throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
    }

    await ensureNightlyAvailability(
      accountId,
      unitId,
      unitUpdates.map((u) => u.date),
    );

    // Bulk-upsert prices via a parametrized VALUES list — same raw-`sql` pattern already
    // used for the FOR UPDATE lock query in inventory.ts, not string concatenation.
    const valuesList = sql.join(
      unitUpdates.map((u) => sql`(${u.date}::date, ${u.priceInCents}::integer)`),
      sql`, `,
    );

    const result = await withTenant(accountId, (tx) =>
      tx.execute(sql`
        update nightly_availability as na
        set price_in_cents = v.price_in_cents, updated_at = now()
        from (values ${valuesList}) as v(date, price_in_cents)
        where na.unit_id = ${unitId} and na.date = v.date
        returning na.id
      `),
    );

    updatedCount += Array.from(result).length;
  }

  return updatedCount;
}
