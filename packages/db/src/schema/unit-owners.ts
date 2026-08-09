import { sql } from "drizzle-orm";
import { numeric, pgPolicy, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";
import { owners } from "./owners";

export const unitOwners = pgTable(
  "unit_owners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    splitPct: numeric("split_pct", { precision: 5, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("unit_owners_unit_owner_unique").on(table.unitId, table.ownerId),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
