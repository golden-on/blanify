import { sql } from "drizzle-orm";
import { integer, jsonb, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { reservations } from "./reservations";
import { payments } from "./payments";

export interface InvoiceLineItem {
  label: string;
  amountInCents: number;
}

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceNumber: text("invoice_number").notNull(),
    lineItems: jsonb("line_items").$type<InvoiceLineItem[]>().notNull(),
    subtotalInCents: integer("subtotal_in_cents").notNull(),
    taxInCents: integer("tax_in_cents").notNull(),
    totalInCents: integer("total_in_cents").notNull(),
    // No PDF rendering is implemented this phase — stays null.
    pdfUrl: text("pdf_url"),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
  },
  (table) => [
    unique("invoices_account_invoice_number_unique").on(table.accountId, table.invoiceNumber),
    // Makes invoice generation idempotent against BullMQ job redelivery.
    unique("invoices_reservation_unique").on(table.reservationId),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
