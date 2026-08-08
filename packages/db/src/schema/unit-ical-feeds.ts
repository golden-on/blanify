import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";

export const icalSyncStatus = pgEnum("ical_sync_status", ["pending", "success", "failed"]);

export const unitIcalFeeds = pgTable(
  "unit_ical_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    syncStatus: icalSyncStatus("sync_status").notNull().default("pending"),
    errorMessage: text("error_message"),
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
