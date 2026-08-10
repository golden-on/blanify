import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { discounts } from "./schema/discounts";

export interface CreateDiscountInput {
  code: string;
  discountType: "percentage" | "fixed_amount";
  value: number;
  minStayNights?: number;
  validFrom: string;
  validTo: string;
}

export async function createDiscount(accountId: string, input: CreateDiscountInput) {
  return withTenant(accountId, async (tx) => {
    const [discount] = await tx
      .insert(discounts)
      .values({
        accountId,
        code: input.code,
        discountType: input.discountType,
        value: input.value.toString(),
        minStayNights: input.minStayNights,
        validFrom: new Date(input.validFrom),
        validTo: new Date(input.validTo),
      })
      .returning();

    if (!discount) {
      throw new Error("Failed to create discount");
    }

    return discount;
  });
}

export async function listDiscountsForAccount(accountId: string) {
  return withTenant(accountId, (tx) => tx.select().from(discounts));
}

export async function deleteDiscount(accountId: string, discountId: string): Promise<void> {
  // RLS alone scopes this delete to the caller's tenant — a cross-tenant discountId
  // simply matches zero rows, same as every other simple CRUD delete in this codebase.
  await withTenant(accountId, (tx) => tx.delete(discounts).where(eq(discounts.id, discountId)));
}

export interface EvaluateDiscountInput {
  accountId: string;
  code: string;
  nightlyTotalInCents: number;
  stayNights: number;
}

export type EvaluateDiscountResult =
  | { valid: true; discountInCents: number; discount: typeof discounts.$inferSelect }
  | { valid: false; reason: string };

export async function evaluateDiscount(input: EvaluateDiscountInput): Promise<EvaluateDiscountResult> {
  const [discount] = await withTenant(input.accountId, (tx) =>
    tx
      .select()
      .from(discounts)
      .where(and(sql`lower(${discounts.code}) = lower(${input.code})`, eq(discounts.accountId, input.accountId))),
  );

  if (!discount) {
    return { valid: false, reason: "Invalid promo code" };
  }
  if (!discount.isActive) {
    return { valid: false, reason: "This promo code is no longer active" };
  }

  const now = new Date();
  if (now < discount.validFrom || now > discount.validTo) {
    return { valid: false, reason: "This promo code is not valid for the current date" };
  }
  if (discount.minStayNights !== null && input.stayNights < discount.minStayNights) {
    return { valid: false, reason: `This promo code requires a minimum stay of ${discount.minStayNights} nights` };
  }

  const rawDiscount =
    discount.discountType === "percentage"
      ? Math.round(input.nightlyTotalInCents * Number(discount.value))
      : Math.round(Number(discount.value));
  const discountInCents = Math.min(rawDiscount, input.nightlyTotalInCents);

  return { valid: true, discountInCents, discount };
}
