import { sql } from "drizzle-orm";
import { numeric, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";

export const taxType = pgEnum("tax_type", ["vat", "tourist_tax", "sales_tax"]);
export const rateType = pgEnum("rate_type", ["percentage", "per_night_flat"]);

// `rateValue` is a fraction (0-1) for 'percentage' (matches discounts.value's
// convention) and whole cents per night for 'per_night_flat' — interpreted in
// src/tax-rules.ts's computeTaxForRules, not here.
export const taxRules = pgTable(
  "tax_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    jurisdiction: text("jurisdiction").notNull(),
    taxType: taxType("tax_type").notNull(),
    rateType: rateType("rate_type").notNull(),
    rateValue: numeric("rate_value", { precision: 10, scale: 4 }).notNull(),
    // Nullable: no specific unit means the rule applies account-wide.
    appliesToUnitId: uuid("applies_to_unit_id").references(() => units.id),
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
