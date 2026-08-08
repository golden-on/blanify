import { sql } from "drizzle-orm";
import { boolean, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const hostedWebsites = pgTable(
  "hosted_websites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    subdomain: text("subdomain").notNull().unique(),
    customDomain: text("custom_domain").unique(),
    themeConfig: jsonb("theme_config").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
    // Lets anonymous domain-resolution queries (no tenant context set) see published
    // sites only. Permissive policies are OR'd, so tenant-scoped admin access above is
    // unaffected; this only ever widens visibility to published rows for SELECT.
    pgPolicy("public_read_published_policy", {
      for: "select",
      to: "public",
      using: sql`${table.isPublished} = true`,
    }),
  ],
).enableRLS();
