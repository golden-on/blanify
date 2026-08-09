import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { reservations } from "./reservations";
import { automationRules } from "./automation-rules";
import { threads } from "./threads";

// Idempotency record for the recurring inbox-automation worker: without this, an
// hourly tick would resend the same reminder every hour once its offset date arrives.
export const automationDispatches = pgTable(
  "automation_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    automationRuleId: uuid("automation_rule_id")
      .notNull()
      .references(() => automationRules.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    unique("automation_dispatches_reservation_rule_unique").on(table.reservationId, table.automationRuleId),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
