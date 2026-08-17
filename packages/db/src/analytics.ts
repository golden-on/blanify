import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { nightlyAvailability } from "./schema/nightly-availability";
import { reservations } from "./schema/reservations";
import { threads } from "./schema/threads";
import { units } from "./schema/units";

export interface AnalyticsSummary {
  periodStart: string;
  periodEnd: string;
  totalRoomRevenueInCents: number;
  bookedNights: number;
  availableNights: number;
  occupancyRate: number;
  adrInCents: number;
  revParInCents: number;
}

export interface DailyAnalyticsPoint {
  date: string;
  bookedNights: number;
  availableNights: number;
  revenueInCents: number;
  occupancyRate: number;
}

// Reservation statuses that represent a live, revenue-bearing stay — used to gate
// occupancy/revenue off of `reservations.status` rather than `nightly_availability.status`
// alone, so a manual host booking's confirmed reservation always counts even if its
// nightly rows haven't (or hadn't) been flipped to 'booked' in lockstep.
const ACTIVE_RESERVATION_STATUSES = ["confirmed", "checked_in", "checked_out"] as const;

function summarize(rows: { date: string; priceInCents: number | null; reservationStatus: string | null }[]) {
  const isActive = (row: (typeof rows)[number]) =>
    row.reservationStatus !== null && (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(row.reservationStatus);

  const bookedRows = rows.filter(isActive);
  const bookedNights = bookedRows.length;
  // "Available Nights" here means total inventory-days in the window
  // (available + booked + blocked), not just rows whose status literally
  // equals 'available' — this is the occupancy denominator, matching the
  // standard hospitality definition (Occupancy = booked / total capacity).
  const availableNights = rows.length;
  const totalRoomRevenueInCents = bookedRows.reduce((sum, row) => sum + (row.priceInCents ?? 0), 0);

  return { bookedNights, availableNights, totalRoomRevenueInCents };
}

export async function getAnalyticsSummary(accountId: string, start: string, end: string): Promise<AnalyticsSummary> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({
        date: nightlyAvailability.date,
        priceInCents: nightlyAvailability.priceInCents,
        reservationStatus: reservations.status,
      })
      .from(nightlyAvailability)
      .leftJoin(reservations, eq(reservations.id, nightlyAvailability.reservationId))
      .where(and(gte(nightlyAvailability.date, start), lte(nightlyAvailability.date, end))),
  );

  const { bookedNights, availableNights, totalRoomRevenueInCents } = summarize(rows);

  return {
    periodStart: start,
    periodEnd: end,
    totalRoomRevenueInCents,
    bookedNights,
    availableNights,
    occupancyRate: availableNights > 0 ? (bookedNights / availableNights) * 100 : 0,
    adrInCents: bookedNights > 0 ? Math.round(totalRoomRevenueInCents / bookedNights) : 0,
    revParInCents: availableNights > 0 ? Math.round(totalRoomRevenueInCents / availableNights) : 0,
  };
}

export async function getDailyAnalyticsSeries(accountId: string, start: string, end: string): Promise<DailyAnalyticsPoint[]> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({
        date: nightlyAvailability.date,
        priceInCents: nightlyAvailability.priceInCents,
        reservationStatus: reservations.status,
      })
      .from(nightlyAvailability)
      .leftJoin(reservations, eq(reservations.id, nightlyAvailability.reservationId))
      .where(and(gte(nightlyAvailability.date, start), lte(nightlyAvailability.date, end))),
  );

  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byDate.get(row.date);
    if (existing) {
      existing.push(row);
    } else {
      byDate.set(row.date, [row]);
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const { bookedNights, availableNights, totalRoomRevenueInCents } = summarize(dayRows);
      return {
        date,
        bookedNights,
        availableNights,
        revenueInCents: totalRoomRevenueInCents,
        occupancyRate: availableNights > 0 ? (bookedNights / availableNights) * 100 : 0,
      };
    });
}

export type RevenueChannel = "direct" | "airbnb" | "booking_com" | "ical" | "manual";

export interface ChannelRevenue {
  channel: RevenueChannel;
  revenueInCents: number;
}

const CHANNEL_BUCKETS: RevenueChannel[] = ["direct", "airbnb", "booking_com", "ical", "manual"];

// A reservation with no thread is a genuine checkout-flow, guest-self-service booking
// (processStripeWebhookEvent never creates one) — the platform's real "direct" channel.
// A thread whose channel is "direct" instead means a host manually entered a walk-in/
// phone booking without picking an OTA source, so that's bucketed "manual" (see Phase 16
// plan Decision 2 — this is the only data-backed way to tell the two apart).
function bucketChannel(threadChannel: string | null): RevenueChannel {
  if (!threadChannel) return "direct";
  if (threadChannel === "direct") return "manual";
  return threadChannel as RevenueChannel;
}

export async function getChannelRevenueBreakdown(accountId: string, start: string, end: string): Promise<ChannelRevenue[]> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({
        priceInCents: nightlyAvailability.priceInCents,
        threadChannel: threads.channel,
      })
      .from(nightlyAvailability)
      .innerJoin(reservations, eq(reservations.id, nightlyAvailability.reservationId))
      .leftJoin(threads, eq(threads.reservationId, reservations.id))
      .where(
        and(
          inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES]),
          gte(nightlyAvailability.date, start),
          lte(nightlyAvailability.date, end),
        ),
      ),
  );

  const totals = new Map<RevenueChannel, number>(CHANNEL_BUCKETS.map((c) => [c, 0]));
  for (const row of rows) {
    const bucket = bucketChannel(row.threadChannel);
    totals.set(bucket, (totals.get(bucket) ?? 0) + (row.priceInCents ?? 0));
  }

  return CHANNEL_BUCKETS.map((channel) => ({ channel, revenueInCents: totals.get(channel) ?? 0 }));
}

function computeAvgLeadTimeDays(rows: { checkIn: string; createdAt: Date }[]): number {
  if (rows.length === 0) return 0;

  const totalDays = rows.reduce((sum, row) => {
    const checkInDate = new Date(`${row.checkIn}T00:00:00Z`);
    const leadDays = (checkInDate.getTime() - row.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    return sum + Math.max(leadDays, 0);
  }, 0);

  return Math.round((totalDays / rows.length) * 10) / 10;
}

// Scoped to reservations whose checkIn falls in [start, end] and aren't cancelled — the
// same implicit scoping getAnalyticsSummary/getDailyAnalyticsSeries already use for
// revenue/occupancy (a cancelled reservation's nights are already back to 'available').
export async function getAverageLeadTimeDays(accountId: string, start: string, end: string): Promise<number> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({ checkIn: reservations.checkIn, createdAt: reservations.createdAt })
      .from(reservations)
      .where(and(ne(reservations.status, "cancelled"), gte(reservations.checkIn, start), lte(reservations.checkIn, end))),
  );

  return computeAvgLeadTimeDays(rows);
}

export interface UnitComparisonRow {
  unitId: string;
  unitName: string;
  totalBookings: number;
  roomRevenueInCents: number;
  occupancyPercent: number;
  avgLeadTimeDays: number;
}

export async function getUnitComparison(accountId: string, start: string, end: string): Promise<UnitComparisonRow[]> {
  const [unitRows, nightRows, reservationRows] = await withTenant(accountId, async (tx) => {
    const unitRowsInner = await tx.select({ id: units.id, name: units.name }).from(units);
    const nightRowsInner = await tx
      .select({
        unitId: nightlyAvailability.unitId,
        date: nightlyAvailability.date,
        priceInCents: nightlyAvailability.priceInCents,
        reservationStatus: reservations.status,
      })
      .from(nightlyAvailability)
      .leftJoin(reservations, eq(reservations.id, nightlyAvailability.reservationId))
      .where(and(gte(nightlyAvailability.date, start), lte(nightlyAvailability.date, end)));
    const reservationRowsInner = await tx
      .select({ unitId: reservations.unitId, checkIn: reservations.checkIn, createdAt: reservations.createdAt })
      .from(reservations)
      .where(and(ne(reservations.status, "cancelled"), gte(reservations.checkIn, start), lte(reservations.checkIn, end)));
    return [unitRowsInner, nightRowsInner, reservationRowsInner] as const;
  });

  return unitRows.map((unit) => {
    const nights = nightRows.filter((n) => n.unitId === unit.id);
    const { bookedNights, availableNights, totalRoomRevenueInCents } = summarize(nights);
    const unitReservations = reservationRows.filter((r) => r.unitId === unit.id);

    return {
      unitId: unit.id,
      unitName: unit.name,
      totalBookings: unitReservations.length,
      roomRevenueInCents: totalRoomRevenueInCents,
      occupancyPercent: availableNights > 0 ? (bookedNights / availableNights) * 100 : 0,
      avgLeadTimeDays: computeAvgLeadTimeDays(unitReservations),
    };
  });
}
