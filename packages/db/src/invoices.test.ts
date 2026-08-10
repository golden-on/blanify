import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { createReservation, ensureNightlyAvailability } from "./inventory";
import { recordPendingPayment } from "./payments";
import { createInvoiceForReservation, getInvoiceByReservationId } from "./invoices";
import { accounts } from "./schema/accounts";
import { properties } from "./schema/properties";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { nightlyAvailability } from "./schema/nightly-availability";
import { payments } from "./schema/payments";
import { invoices } from "./schema/invoices";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("invoices", () => {
  let account: { id: string };
  let unit: { id: string };
  let reservationA: { id: string };
  let reservationB: { id: string };
  let paymentA: { id: string };
  let paymentB: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Invoices Test Tenant" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    await ensureNightlyAvailability(account.id, unit.id, ["2029-09-01", "2029-09-02", "2029-09-03", "2029-09-04"], 10000);
    reservationA = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2029-09-01", checkOut: "2029-09-03" });
    reservationB = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2029-09-03", checkOut: "2029-09-05" });

    paymentA = await recordPendingPayment({ accountId: account.id, stripePaymentIntentId: "pi_test_invoice_a", amountInCents: 21600, currency: "usd" });
    paymentB = await recordPendingPayment({ accountId: account.id, stripePaymentIntentId: "pi_test_invoice_b", amountInCents: 20000, currency: "usd" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(invoices).where(eq(invoices.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(payments).where(eq(payments.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("assigns sequential invoice numbers per account and computes the total", async () => {
    const invoiceA = await createInvoiceForReservation({
      accountId: account.id,
      reservationId: reservationA.id,
      paymentId: paymentA.id,
      subtotalInCents: 20000,
      taxInCents: 1600,
      lineItems: [{ label: "Nightly rate", amountInCents: 20000 }, { label: "State sales tax", amountInCents: 1600 }],
    });
    const invoiceB = await createInvoiceForReservation({
      accountId: account.id,
      reservationId: reservationB.id,
      paymentId: paymentB.id,
      subtotalInCents: 20000,
      taxInCents: 0,
      lineItems: [{ label: "Nightly rate", amountInCents: 20000 }],
    });

    expect(invoiceA?.invoiceNumber).toBe("INV-000001");
    expect(invoiceA?.totalInCents).toBe(21600);
    expect(invoiceB?.invoiceNumber).toBe("INV-000002");
    expect(invoiceB?.totalInCents).toBe(20000);
  }, 20000);

  it("is idempotent against redelivery for the same reservation", async () => {
    const before = await getInvoiceByReservationId(account.id, reservationA.id);

    const duplicate = await createInvoiceForReservation({
      accountId: account.id,
      reservationId: reservationA.id,
      paymentId: paymentA.id,
      subtotalInCents: 20000,
      taxInCents: 1600,
      lineItems: [{ label: "Nightly rate", amountInCents: 20000 }],
    });

    expect(duplicate).toBeNull();
    const after = await getInvoiceByReservationId(account.id, reservationA.id);
    expect(after?.invoiceNumber).toBe(before?.invoiceNumber);
  }, 20000);
});
