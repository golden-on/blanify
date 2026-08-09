import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { reservations } from "./reservations";
import { smartLocks } from "./smart-locks";

export const accessCodeStatus = pgEnum("access_code_status", ["active", "expired", "revoked"]);

export const accessCodes = pgTable(
  "access_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    smartLockId: uuid("smart_lock_id")
      .notNull()
      .references(() => smartLocks.id),
    code: text("code").notNull(),
    // The lock provider's own id for this code (e.g. Seam's access code id), needed to
    // call revokeAccessCode later — distinct from our own `id` and the human-facing `code`.
    externalAccessCodeId: text("external_access_code_id"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    status: accessCodeStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("access_codes_reservation_smart_lock_unique").on(table.reservationId, table.smartLockId),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
