import { eq } from "drizzle-orm";
import { TenantAccessError } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { units } from "./schema/units";
import { unitAddOns } from "./schema/unit-add-ons";

async function assertUnitBelongsToAccount(accountId: string, unitId: string): Promise<void> {
  const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
  if (!unit) {
    throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
  }
}

export interface CreateAddOnInput {
  unitId: string;
  name: string;
  description?: string;
  priceInCents: number;
  feeType: "per_stay" | "per_night";
  isRequired?: boolean;
}

export async function createAddOn(accountId: string, input: CreateAddOnInput) {
  await assertUnitBelongsToAccount(accountId, input.unitId);

  return withTenant(accountId, async (tx) => {
    const [addOn] = await tx
      .insert(unitAddOns)
      .values({
        accountId,
        unitId: input.unitId,
        name: input.name,
        description: input.description,
        priceInCents: input.priceInCents,
        feeType: input.feeType,
        isRequired: input.isRequired,
      })
      .returning();

    if (!addOn) {
      throw new Error("Failed to create add-on");
    }

    return addOn;
  });
}

export async function getUnitAddOns(accountId: string, unitId: string) {
  return withTenant(accountId, (tx) => tx.select().from(unitAddOns).where(eq(unitAddOns.unitId, unitId)));
}

export async function deleteAddOn(accountId: string, addOnId: string): Promise<void> {
  await withTenant(accountId, (tx) => tx.delete(unitAddOns).where(eq(unitAddOns.id, addOnId)));
}
