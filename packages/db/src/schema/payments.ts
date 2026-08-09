import { sql } from "drizzle-orm";
import { integer, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { reservations } from "./reservations";

export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    amountInCents: integer("amount_in_cents").notNull(),
    platformFeeInCents: integer("platform_fee_in_cents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    status: paymentStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
