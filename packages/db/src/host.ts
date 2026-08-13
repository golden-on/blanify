import { and, eq, gte, lte } from "drizzle-orm";
import { TenantAccessError, type ReservationChannel } from "@repo/shared-types";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { getReservationById } from "./smart-locks";
import { blockDates, unblockDates, createReservation } from "./inventory";
import { getCleaningTaskForReservation } from "./housekeeping";
import { units } from "./schema/units";
import { properties } from "./schema/properties";
import { nightlyAvailability } from "./schema/nightly-availability";
import { payments } from "./schema/payments";
import { threads } from "./schema/threads";
import { guestSessions } from "./schema/guest-sessions";

const WEB_ENGINE_URL = process.env.WEB_ENGINE_URL ?? "http://localhost:3001";

export async function listUnitsForAccount(accountId: string) {
  return withTenant(accountId, async (tx) => {
    const rows = await tx
      .select({ unit: units, propertyName: properties.name })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId));

    return rows.map(({ unit, propertyName }) => ({ ...unit, propertyName }));
  });
}

// blockDates/unblockDates/ensureNightlyAvailability never checked unit ownership
// themselves — every prior caller (OTA webhook processing, direct booking) already
// resolved unitId from a trusted source. These host routes take unitId straight from
// a URL a caller controls, so without this check an authenticated tenant could target
// another tenant's unitId and silently create a nightly_availability row for it under
// their own accountId, effectively squatting on that unit/date pair.
async function assertUnitBelongsToAccount(accountId: string, unitId: string): Promise<void> {
  const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
  if (!unit) {
    throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
  }
}

export interface CalendarNight {
  date: string;
  status: "available" | "booked" | "blocked";
  priceInCents: number | null;
  reservationId: string | null;
  blockReason: string | null;
  guestName: string | null;
  channel: string | null;
}

export async function getUnitCalendar(accountId: string, unitId: string, start: string, end: string): Promise<CalendarNight[]> {
  await assertUnitBelongsToAccount(accountId, unitId);

  return withTenant(accountId, (tx) =>
    tx
      .select({
        date: nightlyAvailability.date,
        status: nightlyAvailability.status,
        priceInCents: nightlyAvailability.priceInCents,
        reservationId: nightlyAvailability.reservationId,
        blockReason: nightlyAvailability.blockReason,
        guestName: threads.guestName,
        channel: threads.channel,
      })
      .from(nightlyAvailability)
      // guestName/channel only ever populated for reservations created via the manual
      // booking endpoint (createHostReservation) — nothing else in the codebase inserts
      // a threads row yet, so OTA/checkout-sourced nights show null here (see Phase 12
      // plan Decision 1).
      .leftJoin(threads, eq(threads.reservationId, nightlyAvailability.reservationId))
      .where(
        and(
          eq(nightlyAvailability.unitId, unitId),
          gte(nightlyAvailability.date, start),
          lte(nightlyAvailability.date, end),
        ),
      ),
  );
}

export async function blockUnitDates(accountId: string, unitId: string, dates: string[], reason?: string): Promise<void> {
  await assertUnitBelongsToAccount(accountId, unitId);
  await blockDates({ accountId, unitId, dates, reason });
}

export async function unblockUnitDates(accountId: string, unitId: string, dates: string[]): Promise<void> {
  await assertUnitBelongsToAccount(accountId, unitId);
  await unblockDates({ accountId, unitId, dates });
}

export interface ReservationDetail {
  reservation: NonNullable<Awaited<ReturnType<typeof getReservationById>>>;
  payment: typeof payments.$inferSelect | null;
  guestName: string | null;
  channel: string | null;
  guestPortalUrl: string | null;
  cleaningTaskStatus: string | null;
}

export async function getReservationDetail(accountId: string, reservationId: string): Promise<ReservationDetail | null> {
  const reservation = await getReservationById(accountId, reservationId);
  if (!reservation) {
    return null;
  }

  const [payment, thread, session] = await withTenant(accountId, async (tx) => {
    const [paymentRow] = await tx.select().from(payments).where(eq(payments.reservationId, reservationId));
    const [threadRow] = await tx.select().from(threads).where(eq(threads.reservationId, reservationId));
    // guest_sessions has no RLS (see schema/guest-sessions.ts) — reservationId here is
    // already tenant-verified by getReservationById above, so this lookup is safe as-is.
    const [sessionRow] = await tx.select().from(guestSessions).where(eq(guestSessions.reservationId, reservationId));
    return [paymentRow, threadRow, sessionRow] as const;
  });
  const cleaningTask = await getCleaningTaskForReservation(accountId, reservationId);

  return {
    reservation,
    payment: payment ?? null,
    guestName: thread?.guestName ?? null,
    channel: thread?.channel ?? null,
    guestPortalUrl: session ? `${WEB_ENGINE_URL}/guest/${session.token}` : null,
    cleaningTaskStatus: cleaningTask?.status ?? null,
  };
}

export interface CreateHostReservationInput {
  unitId: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestEmail?: string;
  channel: ReservationChannel;
  totalPriceInCents?: number;
}

// The one code path (besides tests) that creates a manual/offline booking directly
// from the host calendar — see Phase 12 plan Decisions 1-3 for why this also mints a
// thread and a guest_sessions row that no other reservation-creation path sets up.
export async function createHostReservation(accountId: string, input: CreateHostReservationInput): Promise<ReservationDetail> {
  await assertUnitBelongsToAccount(accountId, input.unitId);

  const reservation = await createReservation({
    accountId,
    unitId: input.unitId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    channel: input.channel,
    totalPriceInCents: input.totalPriceInCents,
  });

  // Mirrors processStripeWebhookEvent's guest-session minting (packages/db/src/
  // payments.ts) so the new Reservation Detail drawer's "copy guest portal URL"
  // button has something to copy for host-created bookings too.
  await db
    .insert(guestSessions)
    .values({ accountId, reservationId: reservation.id, token: crypto.randomUUID() })
    .onConflictDoNothing({ target: [guestSessions.reservationId] });

  const detail = await getReservationDetail(accountId, reservation.id);
  if (!detail) {
    throw new Error("Failed to load newly created reservation");
  }
  return detail;
}
