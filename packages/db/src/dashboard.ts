import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { threads } from "./schema/threads";
import { getStripeAccountForTenant } from "./stripe-accounts";
import { listTaxRulesForAccount } from "./tax-rules";
import { isWebsitePublished } from "./websites";
import { hasAnyChannelConnection } from "./channels";
import { countOpenThreads } from "./inbox";
import { getAnalyticsSummary } from "./analytics";

export interface SetupChecklist {
  hasUnits: boolean;
  hasStripeConnected: boolean;
  hasTaxRules: boolean;
  hasWebsitePublished: boolean;
  hasChannelsConnected: boolean;
}

export async function getSetupChecklist(accountId: string): Promise<SetupChecklist> {
  const [unitCount, stripeAccount, taxRules, websitePublished, channelsConnected] = await Promise.all([
    withTenant(accountId, async (tx) => {
      const [row] = await tx.select({ count: sql<number>`count(*)::int`.mapWith(Number) }).from(units);
      return row?.count ?? 0;
    }),
    getStripeAccountForTenant(accountId),
    listTaxRulesForAccount(accountId),
    isWebsitePublished(accountId),
    hasAnyChannelConnection(accountId),
  ]);

  return {
    hasUnits: unitCount > 0,
    hasStripeConnected: !!stripeAccount,
    hasTaxRules: taxRules.length > 0,
    hasWebsitePublished: websitePublished,
    hasChannelsConnected: channelsConnected,
  };
}

export interface DashboardReservation {
  id: string;
  unitName: string | null;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
}

export interface TodaysActivity {
  checkIns: DashboardReservation[];
  checkOuts: DashboardReservation[];
  currentlyStaying: DashboardReservation[];
}

// One query covering anything touching `today` (arrival, departure, or an ongoing stay),
// bucketed in JS so each reservation lands in exactly one list — see Phase 16 plan
// Decision 6 for why "currently staying" excludes today's arrivals/departures.
export async function getTodaysActivity(accountId: string, today: string): Promise<TodaysActivity> {
  const rows = await withTenant(accountId, (tx) =>
    tx
      .select({
        id: reservations.id,
        unitName: units.name,
        guestName: threads.guestName,
        checkIn: reservations.checkIn,
        checkOut: reservations.checkOut,
      })
      .from(reservations)
      .innerJoin(units, eq(units.id, reservations.unitId))
      .leftJoin(threads, eq(threads.reservationId, reservations.id))
      .where(and(ne(reservations.status, "cancelled"), lte(reservations.checkIn, today), gte(reservations.checkOut, today))),
  );

  return {
    checkIns: rows.filter((r) => r.checkIn === today),
    checkOuts: rows.filter((r) => r.checkOut === today),
    currentlyStaying: rows.filter((r) => r.checkIn < today && r.checkOut > today),
  };
}

export interface QuickKpis {
  activeReservationsCount: number;
  occupancyRateThisMonth: number;
  revenueThisMonthInCents: number;
  openThreadsCount: number;
}

export async function getQuickKpis(accountId: string, today: string, monthStart: string, monthEnd: string): Promise<QuickKpis> {
  const [activeReservationsCount, monthlySummary, openThreadsCount] = await Promise.all([
    withTenant(accountId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
        .from(reservations)
        .where(and(eq(reservations.status, "confirmed"), gte(reservations.checkOut, today)));
      return row?.count ?? 0;
    }),
    getAnalyticsSummary(accountId, monthStart, monthEnd),
    countOpenThreads(accountId),
  ]);

  return {
    activeReservationsCount,
    occupancyRateThisMonth: monthlySummary.occupancyRate,
    revenueThisMonthInCents: monthlySummary.totalRoomRevenueInCents,
    openThreadsCount,
  };
}

export interface DashboardSummary {
  checklist: SetupChecklist;
  today: TodaysActivity;
  kpis: QuickKpis;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getDashboardSummary(accountId: string): Promise<DashboardSummary> {
  const now = new Date();
  const today = isoDate(now);
  const monthStart = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const monthEnd = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

  const [checklist, activity, kpis] = await Promise.all([
    getSetupChecklist(accountId),
    getTodaysActivity(accountId, today),
    getQuickKpis(accountId, today, monthStart, monthEnd),
  ]);

  return { checklist, today: activity, kpis };
}
