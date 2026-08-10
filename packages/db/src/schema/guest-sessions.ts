import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { reservations } from "./reservations";

// Intentionally NOT RLS-protected: a guest opens /guest/:token with only the token —
// no accountId, no login — so resolving *which* tenant this session belongs to is the
// entire point of the by-token lookup. Same structural bind as users.ts/
// channel_unit_mappings/webhook_events. Only two queries ever touch this table: the
// unscoped lookup by unique token, and a server-controlled insert (from the Stripe
// webhook handler, which already has a trusted accountId) — no route ever accepts an
// accountId or reservationId from an untrusted caller to create or query this table.
export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    token: text("token").notNull(),
    signedAgreementUrl: text("signed_agreement_url"),
    checkInCompletedAt: timestamp("check_in_completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("guest_sessions_reservation_unique").on(table.reservationId), unique("guest_sessions_token_unique").on(table.token)],
);
