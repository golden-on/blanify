import { sql } from "drizzle-orm";
import { date, integer, pgEnum, pgPolicy, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { owners } from "./owners";

export const payoutStatus = pgEnum("payout_status", ["draft", "issued", "paid"]);

export const payoutStatements = pgTable(
  "payout_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    grossRevenueInCents: integer("gross_revenue_in_cents").notNull(),
    commissionInCents: integer("commission_in_cents").notNull(),
    netPayoutInCents: integer("net_payout_in_cents").notNull(),
    status: payoutStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Backs the idempotent monthly payout worker — re-running the job for a
    // period that already has a statement is a no-op rather than a duplicate.
    unique("payout_statements_owner_period_unique").on(table.ownerId, table.periodStart, table.periodEnd),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
