import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";
import { channelConnections } from "./channel-connections";

// Intentionally NOT RLS-protected: inbound webhooks identify an external property/room,
// not an accountId, so this table is what tenant resolution is built on top of — the same
// reason `accounts` has no RLS. See Phase 3 Level 2 plan for the full reasoning.
export const channelUnitMappings = pgTable(
  "channel_unit_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    channelConnectionId: uuid("channel_connection_id")
      .notNull()
      .references(() => channelConnections.id),
    externalPropertyId: text("external_property_id").notNull(),
    externalRoomId: text("external_room_id").notNull(),
    syncRatesEnabled: boolean("sync_rates_enabled").notNull().default(true),
    syncAvailabilityEnabled: boolean("sync_availability_enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("channel_unit_mappings_unit_connection_unique").on(table.unitId, table.channelConnectionId)],
);
