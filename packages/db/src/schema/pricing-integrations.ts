import { sql } from "drizzle-orm";
import { boolean, pgEnum, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const pricingProvider = pgEnum("pricing_provider", ["pricelabs", "beyond"]);

export const pricingIntegrations = pgTable(
  "pricing_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    provider: pricingProvider("provider").notNull(),
    apiKey: text("api_key").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("pricing_integrations_account_provider_unique").on(table.accountId, table.provider),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
