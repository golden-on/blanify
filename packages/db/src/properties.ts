import { eq } from "drizzle-orm";
import { TenantAccessError } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { properties } from "./schema/properties";
import { units } from "./schema/units";

export interface CreatePropertyInput {
  name: string;
  address?: string;
}

export async function createProperty(accountId: string, input: CreatePropertyInput) {
  return withTenant(accountId, async (tx) => {
    const [property] = await tx
      .insert(properties)
      .values({ accountId, name: input.name, address: input.address })
      .returning();

    if (!property) {
      throw new Error("Failed to create property");
    }

    return property;
  });
}

export interface CreateUnitInput {
  propertyId: string;
  name: string;
  checkInInstructions?: string;
}

// Mirrors host.ts's assertUnitBelongsToAccount: propertyId comes straight from a
// request body a caller controls, so without this check a tenant could attach a
// new unit to another tenant's property.
async function assertPropertyBelongsToAccount(accountId: string, propertyId: string): Promise<void> {
  const [property] = await withTenant(accountId, (tx) =>
    tx.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId)),
  );
  if (!property) {
    throw new TenantAccessError(`Property ${propertyId} does not belong to this account`);
  }
}

export async function createUnit(accountId: string, input: CreateUnitInput) {
  await assertPropertyBelongsToAccount(accountId, input.propertyId);

  return withTenant(accountId, async (tx) => {
    const [unit] = await tx
      .insert(units)
      .values({
        accountId,
        propertyId: input.propertyId,
        name: input.name,
        checkInInstructions: input.checkInInstructions,
      })
      .returning();

    if (!unit) {
      throw new Error("Failed to create unit");
    }

    return unit;
  });
}
