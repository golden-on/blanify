import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { TenantAccessError, type InvoiceLineItem, type ReservationChannel, type UpdateUnitRequest } from "@repo/shared-types";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { getReservationById } from "./smart-locks";
import { blockDates, unblockDates, createReservation } from "./inventory";
import { getCleaningTaskForReservation } from "./housekeeping";
import { getInvoiceByReservationId } from "./invoices";
import { getCapturedDepositTotal } from "./deposit-claims";
import { units } from "./schema/units";
import { properties } from "./schema/properties";
import { reservations } from "./schema/reservations";
import { nightlyAvailability } from "./schema/nightly-availability";
import { payments } from "./schema/payments";
import { threads } from "./schema/threads";
import { guestSessions } from "./schema/guest-sessions";

const WEB_ENGINE_URL = process.env.WEB_ENGINE_URL ?? "http://localhost:3001";

export async function listUnitsForAccount(accountId: string) {
  return withTenant(accountId, async (tx) => {
    const rows = await tx
      .select({ unit: units, propertyName: properties.name, propertyAddress: properties.address })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId));

    return rows.map(({ unit, propertyName, propertyAddress }) => ({ ...unit, propertyName, propertyAddress }));
  });
}

// blockDates/unblockDates/ensureNightlyAvailability never checked unit ownership
// themselves — every prior caller (OTA webhook processing, direct booking) already
// resolved unitId from a trusted source. These host routes take unitId straight from
// a URL a caller controls, so without this check an authenticated tenant could target
// another tenant's unitId and silently create a nightly_availability row for it under
// their own accountId, effectively squatting on that unit/date pair.
export async function assertUnitBelongsToAccount(accountId: string, unitId: string): Promise<void> {
  const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
  if (!unit) {
    throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
  }
}

export async function updateUnit(accountId: string, unitId: string, input: UpdateUnitRequest) {
  await assertUnitBelongsToAccount(accountId, unitId);

  return withTenant(accountId, async (tx) => {
    const [unit] = await tx
      .update(units)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.checkInInstructions !== undefined && { checkInInstructions: input.checkInInstructions }),
        ...(input.roomsConfig !== undefined && { roomsConfig: input.roomsConfig }),
        ...(input.amenities !== undefined && { amenities: input.amenities }),
        ...(input.photos !== undefined && { photos: input.photos }),
        ...(input.policies !== undefined && { policies: input.policies }),
      })
      .where(eq(units.id, unitId))
      .returning();

    if (!unit) {
      throw new Error("Failed to update unit");
    }
    return unit;
  });
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

export interface ListReservationsFilters {
  search?: string;
  status?: string;
  unitId?: string;
  startDate?: string;
  endDate?: string;
  page: number;
  pageSize: number;
}

export async function listReservationsForAccount(accountId: string, filters: ListReservationsFilters) {
  const { search, status, unitId, startDate, endDate, page, pageSize } = filters;

  return withTenant(accountId, async (tx) => {
    const offset = (page - 1) * pageSize;

    const conditions = [
      status ? eq(reservations.status, status) : undefined,
      unitId ? eq(reservations.unitId, unitId) : undefined,
      startDate ? gte(reservations.checkIn, startDate) : undefined,
      endDate ? lte(reservations.checkIn, endDate) : undefined,
      search
        ? or(sql`${threads.guestName} ilike ${`%${search}%`}`, sql`${threads.guestEmail} ilike ${`%${search}%`}`)
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await tx
      .select({
        reservation: reservations,
        unitName: units.name,
        guestName: threads.guestName,
        guestEmail: threads.guestEmail,
        channel: threads.channel,
        // Sum of this reservation's nightly_availability rows — the "base rate" fallback
        // used both here and in getReservationDetail (see Phase 15 plan Decision 2).
        baseRateInCents: sql<number>`coalesce((select sum(na.price_in_cents) from nightly_availability na where na.reservation_id = ${reservations.id}), 0)`.mapWith(Number),
        invoiceTotalInCents: sql<number | null>`(select inv.total_in_cents from invoices inv where inv.reservation_id = ${reservations.id})`,
        paidInCents: sql<number>`coalesce((select p.amount_in_cents from payments p where p.reservation_id = ${reservations.id} and p.status = 'succeeded'), 0)`.mapWith(Number),
      })
      .from(reservations)
      .innerJoin(units, eq(units.id, reservations.unitId))
      .leftJoin(threads, eq(threads.reservationId, reservations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reservations.checkIn))
      .limit(pageSize)
      .offset(offset);

    return rows.map((row) => ({
      ...row.reservation,
      unitName: row.unitName,
      guestName: row.guestName,
      guestEmail: row.guestEmail,
      channel: row.channel,
      totalInCents: row.invoiceTotalInCents ?? row.baseRateInCents,
      paidInCents: row.paidInCents,
    }));
  });
}

export interface ReservationFinancials {
  lineItems: InvoiceLineItem[];
  subtotalInCents: number;
  taxInCents: number;
  totalInCents: number;
  paidInCents: number;
  dueInCents: number;
  depositCapturedInCents: number;
}

export interface ReservationDetail {
  reservation: NonNullable<Awaited<ReturnType<typeof getReservationById>>>;
  unitName: string | null;
  payment: typeof payments.$inferSelect | null;
  guestName: string | null;
  guestEmail: string | null;
  channel: string | null;
  guestPortalUrl: string | null;
  cleaningTaskStatus: string | null;
  financials: ReservationFinancials;
}

export async function getReservationDetail(accountId: string, reservationId: string): Promise<ReservationDetail | null> {
  const reservation = await getReservationById(accountId, reservationId);
  if (!reservation) {
    return null;
  }

  const [payment, thread, session, unit, nightlyRows] = await withTenant(accountId, async (tx) => {
    const [paymentRow] = await tx.select().from(payments).where(eq(payments.reservationId, reservationId));
    const [threadRow] = await tx.select().from(threads).where(eq(threads.reservationId, reservationId));
    // guest_sessions has no RLS (see schema/guest-sessions.ts) — reservationId here is
    // already tenant-verified by getReservationById above, so this lookup is safe as-is.
    const [sessionRow] = await tx.select().from(guestSessions).where(eq(guestSessions.reservationId, reservationId));
    const [unitRow] = await tx.select({ name: units.name }).from(units).where(eq(units.id, reservation.unitId));
    const nightRows = await tx
      .select({ priceInCents: nightlyAvailability.priceInCents })
      .from(nightlyAvailability)
      .where(eq(nightlyAvailability.reservationId, reservationId));
    return [paymentRow, threadRow, sessionRow, unitRow, nightRows] as const;
  });
  const cleaningTask = await getCleaningTaskForReservation(accountId, reservationId);

  // Checkout-flow reservations get a real itemized invoice (Phase 11 worker); host-created
  // manual bookings never generate one, so this falls back to a single "Base rate" line
  // synthesized from the booked nights (see Phase 15 plan Decision 2).
  const invoice = await getInvoiceByReservationId(accountId, reservationId);
  const baseRateInCents = nightlyRows.reduce((sum, row) => sum + (row.priceInCents ?? 0), 0);
  const paidInCents = payment?.status === "succeeded" ? payment.amountInCents : 0;
  const totalInCents = invoice?.totalInCents ?? baseRateInCents;
  const depositCapturedInCents = await getCapturedDepositTotal(accountId, reservationId);

  const financials: ReservationFinancials = {
    lineItems: invoice?.lineItems ?? [{ label: "Base rate", amountInCents: baseRateInCents }],
    subtotalInCents: invoice?.subtotalInCents ?? baseRateInCents,
    taxInCents: invoice?.taxInCents ?? 0,
    totalInCents,
    paidInCents,
    dueInCents: Math.max(totalInCents - paidInCents, 0),
    depositCapturedInCents,
  };

  return {
    reservation,
    unitName: unit?.name ?? null,
    payment: payment ?? null,
    guestName: thread?.guestName ?? null,
    guestEmail: thread?.guestEmail ?? null,
    channel: thread?.channel ?? null,
    guestPortalUrl: session ? `${WEB_ENGINE_URL}/guest/${session.token}` : null,
    cleaningTaskStatus: cleaningTask?.status ?? null,
    financials,
  };
}

// Callers are expected to check `reservation.status !== "cancelled"` themselves first
// (see routes/reservations.ts). Returns just the updated reservation row rather than a
// full ReservationDetail — the caller already has a fresh detail from that precondition
// check, so re-fetching it here would double every one of getReservationDetail's several
// sequential queries for no benefit (and materially slows this down against real Postgres
// network latency).
export async function cancelReservation(accountId: string, reservationId: string) {
  const reservation = await getReservationById(accountId, reservationId);
  if (!reservation) {
    return null;
  }

  return withTenant(accountId, async (tx) => {
    await tx
      .update(nightlyAvailability)
      .set({ status: "available", reservationId: null, blockReason: null, updatedAt: new Date() })
      .where(eq(nightlyAvailability.reservationId, reservationId));

    const [updated] = await tx.update(reservations).set({ status: "cancelled" }).where(eq(reservations.id, reservationId)).returning();
    return updated ?? null;
  });
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
