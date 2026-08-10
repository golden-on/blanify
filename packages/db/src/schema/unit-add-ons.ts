import { sql } from "drizzle-orm";
import { boolean, integer, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";

export const addOnFeeType = pgEnum("add_on_fee_type", ["per_stay", "per_night"]);

export const unitAddOns = pgTable(
  "unit_add_ons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    name: text("name").notNull(),
    description: text("description"),
    priceInCents: integer("price_in_cents").notNull(),
    feeType: addOnFeeType("fee_type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
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
