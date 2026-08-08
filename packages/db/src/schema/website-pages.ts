import { sql } from "drizzle-orm";
import { boolean, jsonb, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { hostedWebsites } from "./hosted-websites";

export const websitePages = pgTable(
  "website_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    websiteId: uuid("website_id")
      .notNull()
      .references(() => hostedWebsites.id),
    slug: text("slug").notNull(),
    layoutSchema: jsonb("layout_schema").notNull(),
    isPublished: boolean("is_published").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("website_pages_website_id_slug_unique").on(table.websiteId, table.slug),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
    pgPolicy("public_read_published_policy", {
      for: "select",
      to: "public",
      using: sql`${table.isPublished} = true`,
    }),
  ],
).enableRLS();
