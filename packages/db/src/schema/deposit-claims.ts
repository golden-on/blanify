import { sql } from "drizzle-orm";
import { integer, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { reservations } from "./reservations";
import { payments } from "./payments";

export const depositClaimStatus = pgEnum("deposit_claim_status", ["pending", "captured", "released", "disputed"]);

export const depositClaims = pgTable(
  "deposit_claims",
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
    amountInCents: integer("amount_in_cents").notNull(),
    reason: text("reason").notNull(),
    status: depositClaimStatus("status").notNull().default("pending"),
    evidenceUrls: jsonb("evidence_urls").$type<string[]>().notNull().default([]),
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
