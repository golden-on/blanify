import { eq, isNull, or } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { taxRules } from "./schema/tax-rules";

export interface CreateTaxRuleInput {
  jurisdiction: string;
  taxType: "vat" | "tourist_tax" | "sales_tax";
  rateType: "percentage" | "per_night_flat";
  rateValue: number;
  appliesToUnitId?: string;
}

export async function createTaxRule(accountId: string, input: CreateTaxRuleInput) {
  return withTenant(accountId, async (tx) => {
    const [rule] = await tx
      .insert(taxRules)
      .values({
        accountId,
        jurisdiction: input.jurisdiction,
        taxType: input.taxType,
        rateType: input.rateType,
        rateValue: input.rateValue.toString(),
        appliesToUnitId: input.appliesToUnitId,
      })
      .returning();

    if (!rule) {
      throw new Error("Failed to create tax rule");
    }

    return rule;
  });
}

export async function listTaxRulesForAccount(accountId: string) {
  return withTenant(accountId, (tx) => tx.select().from(taxRules));
}

export async function deleteTaxRule(accountId: string, taxRuleId: string): Promise<void> {
  await withTenant(accountId, (tx) => tx.delete(taxRules).where(eq(taxRules.id, taxRuleId)));
}

// A rule with no appliesToUnitId applies account-wide; a unit-scoped rule only
// applies to that specific unit.
export async function getApplicableTaxRules(accountId: string, unitId: string) {
  return withTenant(accountId, (tx) =>
    tx
      .select()
      .from(taxRules)
      .where(or(isNull(taxRules.appliesToUnitId), eq(taxRules.appliesToUnitId, unitId))),
  );
}

export interface TaxLineItem {
  ruleId: string;
  label: string;
  amountInCents: number;
}

export interface ComputeTaxResult {
  taxInCents: number;
  lineItems: TaxLineItem[];
}

// `taxableBaseInCents` is the subtotal tax applies to (nightly + add-ons -
// discount, clamped to >= 0); `stayNights` scales per_night_flat rules.
export function computeTaxForRules(
  rules: (typeof taxRules.$inferSelect)[],
  taxableBaseInCents: number,
  stayNights: number,
): ComputeTaxResult {
  const lineItems: TaxLineItem[] = rules.map((rule) => {
    const amountInCents =
      rule.rateType === "percentage"
        ? Math.round(taxableBaseInCents * Number(rule.rateValue))
        : Math.round(Number(rule.rateValue)) * stayNights;
    return {
      ruleId: rule.id,
      label: `${rule.jurisdiction} ${rule.taxType.replace("_", " ")}`,
      amountInCents,
    };
  });

  const taxInCents = lineItems.reduce((sum, item) => sum + item.amountInCents, 0);

  return { taxInCents, lineItems };
}
