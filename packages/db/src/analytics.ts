import { and, gte, lte } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { nightlyAvailability } from "./schema/nightly-availability";

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

function summarize(rows: { date: string; status: string; priceInCents: number | null }[]) {
  const bookedNights = rows.filter((row) => row.status === "booked").length;
  // "Available Nights" here means total inventory-days in the window
  // (available + booked + blocked), not just rows whose status literally
  // equals 'available' — this is the occupancy denominator, matching the
  // standard hospitality definition (Occupancy = booked / total capacity).
  const availableNights = rows.length;
  const totalRoomRevenueInCents = rows
    .filter((row) => row.status === "booked")
    .reduce((sum, row) => sum + (row.priceInCents ?? 0), 0);

  return { bookedNights, availableNights, totalRoomRevenueInCents };
}

export async function getAnalyticsSummary(accountId: string, start: string, end: string): Promise<AnalyticsSummary> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({
        date: nightlyAvailability.date,
        status: nightlyAvailability.status,
        priceInCents: nightlyAvailability.priceInCents,
      })
      .from(nightlyAvailability)
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
        status: nightlyAvailability.status,
        priceInCents: nightlyAvailability.priceInCents,
      })
      .from(nightlyAvailability)
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
