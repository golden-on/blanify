import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// Intentionally NOT RLS-protected: login only has an email and password — no
// accountId yet, since resolving *which* tenant is the entire point of logging in.
// Same structural bind as channel_unit_mappings/webhook_events (a table that must be
// queryable before the tenant context RLS depends on is known). No route ever
// returns raw rows from this table to a client; the only queries against it are the
// server-controlled login lookup (by unique email) and the registration insert.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("users_email_unique").on(table.email)],
);
