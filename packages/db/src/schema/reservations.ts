import { sql } from "drizzle-orm";
import { date, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    checkIn: date("check_in", { mode: "string" }).notNull(),
    checkOut: date("check_out", { mode: "string" }).notNull(),
    status: text("status").notNull().default("confirmed"),
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
