import { sql } from "drizzle-orm";
import { boolean, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const stripeAccounts = pgTable(
  "stripe_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    stripeAccountId: text("stripe_account_id").notNull().unique(),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
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
