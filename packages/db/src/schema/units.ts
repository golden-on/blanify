import { sql } from "drizzle-orm";
import { jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { RoomConfig, UnitPhoto, UnitPolicies } from "@repo/shared-types";
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
    checkInInstructions: text("check_in_instructions"),
    roomsConfig: jsonb("rooms_config").$type<RoomConfig>(),
    amenities: jsonb("amenities").$type<string[]>(),
    photos: jsonb("photos").$type<UnitPhoto[]>(),
    policies: jsonb("policies").$type<UnitPolicies>(),
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
