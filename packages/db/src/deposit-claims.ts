import { and, eq } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { depositClaims } from "./schema/deposit-claims";

export interface CreateDepositClaimInput {
  accountId: string;
  reservationId: string;
  paymentId: string;
  amountInCents: number;
  reason: string;
  evidenceUrls: string[];
}

// Only called after a successful Stripe capture, so the row is always inserted
// as "captured" — there's no separate pending state in this flow.
export async function createDepositClaim(input: CreateDepositClaimInput) {
  return withTenant(input.accountId, async (tx) => {
    const [claim] = await tx
      .insert(depositClaims)
      .values({
        accountId: input.accountId,
        reservationId: input.reservationId,
        paymentId: input.paymentId,
        amountInCents: input.amountInCents,
        reason: input.reason,
        evidenceUrls: input.evidenceUrls,
        status: "captured",
      })
      .returning();

    if (!claim) {
      throw new Error("Failed to create deposit claim");
    }

    return claim;
  });
}

export async function getCapturedDepositTotal(accountId: string, reservationId: string): Promise<number> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({ amountInCents: depositClaims.amountInCents })
      .from(depositClaims)
      .where(and(eq(depositClaims.reservationId, reservationId), eq(depositClaims.status, "captured"))),
  );
  return rows.reduce((sum, row) => sum + row.amountInCents, 0);
}
