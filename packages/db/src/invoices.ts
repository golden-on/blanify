import { eq, sql } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { invoices, type InvoiceLineItem } from "./schema/invoices";

export interface CreateInvoiceInput {
  accountId: string;
  reservationId: string;
  paymentId: string;
  subtotalInCents: number;
  taxInCents: number;
  lineItems: InvoiceLineItem[];
}

export async function createInvoiceForReservation(input: CreateInvoiceInput) {
  return withTenant(input.accountId, async (tx) => {
    // Serialize invoice-number assignment per tenant — `accounts` has no RLS,
    // so this lock is visible/effective regardless of tenant context. Without
    // it, two concurrent webhook deliveries for the same account could compute
    // the same "next" sequence number.
    await tx.execute(sql`SELECT 1 FROM accounts WHERE id = ${input.accountId} FOR UPDATE`);

    const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(invoices);
    const invoiceNumber = `INV-${String((countRow?.count ?? 0) + 1).padStart(6, "0")}`;
    const totalInCents = input.subtotalInCents + input.taxInCents;

    const [invoice] = await tx
      .insert(invoices)
      .values({
        accountId: input.accountId,
        reservationId: input.reservationId,
        paymentId: input.paymentId,
        invoiceNumber,
        lineItems: input.lineItems,
        subtotalInCents: input.subtotalInCents,
        taxInCents: input.taxInCents,
        totalInCents,
      })
      // Idempotent against BullMQ job redelivery for the same reservation.
      .onConflictDoNothing({ target: [invoices.reservationId] })
      .returning();

    return invoice ?? null;
  });
}

export async function getInvoiceByReservationId(accountId: string, reservationId: string) {
  const [invoice] = await withTenant(accountId, (tx) =>
    tx.select().from(invoices).where(eq(invoices.reservationId, reservationId)),
  );
  return invoice ?? null;
}
