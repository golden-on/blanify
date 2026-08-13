import { sql } from "drizzle-orm";
import { date, integer, pgEnum, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";
import { reservations } from "./reservations";

export const nightlyAvailabilityStatus = pgEnum("nightly_availability_status", [
  "available",
  "booked",
  "blocked",
]);

export const nightlyAvailability = pgTable(
  "nightly_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    date: date("date", { mode: "string" }).notNull(),
    status: nightlyAvailabilityStatus("status").notNull().default("available"),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    priceInCents: integer("price_in_cents"),
    // Set when status is 'blocked' via a host-created closed period; cleared back to
    // null on unblock.
    blockReason: text("block_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("nightly_availability_unit_date_unique").on(table.unitId, table.date),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
