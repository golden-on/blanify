import { eq } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { stripeAccounts } from "./schema/stripe-accounts";

export async function getStripeAccountForTenant(accountId: string) {
  return withTenant(accountId, async (tx) => {
    const [row] = await tx.select().from(stripeAccounts).where(eq(stripeAccounts.accountId, accountId));
    return row;
  });
}
