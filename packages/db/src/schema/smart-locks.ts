import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";

export const smartLockStatus = pgEnum("smart_lock_status", ["online", "offline", "error"]);

export const smartLocks = pgTable(
  "smart_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    provider: text("provider").notNull(),
    externalDeviceId: text("external_device_id").notNull(),
    deviceName: text("device_name").notNull(),
    // Defaults to 'offline' until a real Seam sync/webhook confirms connectivity —
    // no such sync flow exists yet, so a freshly-registered lock shouldn't claim 'online'.
    status: smartLockStatus("status").notNull().default("offline"),
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
