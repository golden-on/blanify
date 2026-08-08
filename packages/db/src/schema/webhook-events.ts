import { jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { channelType } from "./channel-connections";

export const webhookEventStatus = pgEnum("webhook_event_status", ["pending", "processed", "failed"]);

// Intentionally NOT RLS-protected — see channel-unit-mappings.ts. This table has no
// accountId (matching the requested schema): it's the pre-tenant-resolution ingestion log.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: channelType("channel").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookEventStatus("status").notNull().default("pending"),
    processedAt: timestamp("processed_at"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("webhook_events_channel_external_event_id_unique").on(table.channel, table.externalEventId)],
);
