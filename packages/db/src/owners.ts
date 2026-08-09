import { and, eq, gte, lte } from "drizzle-orm";
import { TenantAccessError } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { db } from "./client";
import { accounts } from "./schema/accounts";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { payments } from "./schema/payments";
import { owners } from "./schema/owners";
import { unitOwners } from "./schema/unit-owners";
import { payoutStatements } from "./schema/payout-statements";

export interface CreateOwnerInput {
  name: string;
  email: string;
  commissionPct: number;
  stripeConnectedAccountId?: string;
}

export async function createOwner(accountId: string, input: CreateOwnerInput) {
  return withTenant(accountId, async (tx) => {
    const [owner] = await tx
      .insert(owners)
      .values({
        accountId,
        name: input.name,
        email: input.email,
        commissionPct: input.commissionPct.toString(),
        stripeConnectedAccountId: input.stripeConnectedAccountId,
      })
      .returning();

    if (!owner) {
      throw new Error("Failed to create owner");
    }

    return owner;
  });
}

export async function listOwnersForAccount(accountId: string) {
  return withTenant(accountId, (tx) => tx.select().from(owners));
}

async function assertUnitBelongsToAccount(accountId: string, unitId: string): Promise<void> {
  const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
  if (!unit) {
    throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
  }
}

export interface CreateUnitOwnerInput {
  unitId: string;
  ownerId: string;
  splitPct: number;
}

export async function createUnitOwner(accountId: string, input: CreateUnitOwnerInput) {
  await assertUnitBelongsToAccount(accountId, input.unitId);

  return withTenant(accountId, async (tx) => {
    const [unitOwner] = await tx
      .insert(unitOwners)
      .values({ accountId, unitId: input.unitId, ownerId: input.ownerId, splitPct: input.splitPct.toString() })
      .returning();

    if (!unitOwner) {
      throw new Error("Failed to create unit owner split");
    }

    return unitOwner;
  });
}

export async function listStatementsForOwner(accountId: string, ownerId: string) {
  return withTenant(accountId, (tx) => tx.select().from(payoutStatements).where(eq(payoutStatements.ownerId, ownerId)));
}

function previousMonthPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEndDate = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  const periodStartDate = new Date(Date.UTC(periodEndDate.getUTCFullYear(), periodEndDate.getUTCMonth(), 1));
  return {
    periodStart: periodStartDate.toISOString().slice(0, 10),
    periodEnd: periodEndDate.toISOString().slice(0, 10),
  };
}

// Called monthly (1st of the month) by packages/queue/src/workers/owner-payout.ts.
// Attribution is deliberately simple for this phase: gross revenue is succeeded
// payments on reservations whose checkIn falls in the target month, split per
// unit_owners.splitPct, minus owners.commissionPct. A real accounting engine (partial
// payments, refunds mid-statement, proration) is Phase 11's job, not this worker's.
export async function generateMonthlyPayoutStatements(): Promise<number> {
  const allAccounts = await db.select().from(accounts);
  const { periodStart, periodEnd } = previousMonthPeriod();
  let created = 0;

  for (const account of allAccounts) {
    await withTenant(account.id, async (tx) => {
      const accountOwners = await tx.select().from(owners);
      if (accountOwners.length === 0) return;

      for (const owner of accountOwners) {
        const splits = await tx.select().from(unitOwners).where(eq(unitOwners.ownerId, owner.id));
        if (splits.length === 0) continue;

        let grossRevenueInCents = 0;
        for (const split of splits) {
          const rows = await tx
            .select({ amountInCents: payments.amountInCents })
            .from(payments)
            .innerJoin(reservations, eq(reservations.id, payments.reservationId))
            .where(
              and(
                eq(reservations.unitId, split.unitId),
                eq(payments.status, "succeeded"),
                gte(reservations.checkIn, periodStart),
                lte(reservations.checkIn, periodEnd),
              ),
            );

          const unitRevenue = rows.reduce((sum, row) => sum + row.amountInCents, 0);
          grossRevenueInCents += Math.round(unitRevenue * Number(split.splitPct));
        }

        if (grossRevenueInCents === 0) continue;

        const commissionInCents = Math.round(grossRevenueInCents * Number(owner.commissionPct));
        const netPayoutInCents = grossRevenueInCents - commissionInCents;

        const [statement] = await tx
          .insert(payoutStatements)
          .values({
            accountId: account.id,
            ownerId: owner.id,
            periodStart,
            periodEnd,
            grossRevenueInCents,
            commissionInCents,
            netPayoutInCents,
          })
          .onConflictDoNothing({ target: [payoutStatements.ownerId, payoutStatements.periodStart, payoutStatements.periodEnd] })
          .returning();

        if (statement) {
          created += 1;
        }
      }
    });
  }

  return created;
}
