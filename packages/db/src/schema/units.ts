import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { properties } from "./properties";

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
