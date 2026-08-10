import { sql } from "drizzle-orm";
import { boolean, integer, numeric, pgEnum, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const discountType = pgEnum("discount_type", ["percentage", "fixed_amount"]);

// `value` is a fraction (0-1) for 'percentage' (matches owners.commissionPct's
// convention) and whole cents for 'fixed_amount' — interpreted in
// src/discounts.ts's evaluateDiscount, not here.
export const discounts = pgTable(
  "discounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    code: text("code").notNull(),
    discountType: discountType("discount_type").notNull(),
    value: numeric("value", { precision: 10, scale: 4 }).notNull(),
    minStayNights: integer("min_stay_nights"),
    validFrom: timestamp("valid_from").notNull(),
    validTo: timestamp("valid_to").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("discounts_account_code_unique").on(table.accountId, table.code),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
