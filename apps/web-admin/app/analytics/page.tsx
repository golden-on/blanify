"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";
import { AnalyticsChart } from "@/components/AnalyticsChart";

interface AnalyticsSummary {
  periodStart: string;
  periodEnd: string;
  totalRoomRevenueInCents: number;
  bookedNights: number;
  availableNights: number;
  occupancyRate: number;
  adrInCents: number;
  revParInCents: number;
}

interface DailyAnalyticsPoint {
  date: string;
  bookedNights: number;
  availableNights: number;
  revenueInCents: number;
  occupancyRate: number;
}

interface ChannelRevenue {
  channel: "direct" | "airbnb" | "booking_com" | "ical" | "manual";
  revenueInCents: number;
}

interface UnitComparisonRow {
  unitId: string;
  unitName: string;
  totalBookings: number;
  roomRevenueInCents: number;
  occupancyPercent: number;
  avgLeadTimeDays: number;
}

const CHANNEL_LABELS: Record<ChannelRevenue["channel"], string> = {
  direct: "Direct",
  airbnb: "Airbnb",
  booking_com: "Booking.com",
  ical: "iCal",
  manual: "Manual",
};

type SortKey = keyof Pick<UnitComparisonRow, "unitName" | "totalBookings" | "roomRevenueInCents" | "occupancyPercent" | "avgLeadTimeDays">;

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [range, setRange] = useState(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { start: isoDate(start), end: isoDate(end) };
  });
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [daily, setDaily] = useState<DailyAnalyticsPoint[]>([]);
  const [channelRevenue, setChannelRevenue] = useState<ChannelRevenue[]>([]);
  const [avgLeadTimeDays, setAvgLeadTimeDays] = useState(0);
  const [unitComparison, setUnitComparison] = useState<UnitComparisonRow[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "roomRevenueInCents", direction: "desc" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{
        summary: AnalyticsSummary;
        daily: DailyAnalyticsPoint[];
        channelRevenue: ChannelRevenue[];
        avgLeadTimeDays: number;
        unitComparison: UnitComparisonRow[];
      }>(`/api/v1/host/analytics?start=${range.start}&end=${range.end}`, token);
      setSummary(body.summary);
      setDaily(body.daily);
      setChannelRevenue(body.channelRevenue);
      setAvgLeadTimeDays(body.avgLeadTimeDays);
      setUnitComparison(body.unitComparison);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load analytics");
    }
  }, [token, range]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" }));
  }

  const sortedUnitComparison = useMemo(() => {
    const rows = [...unitComparison];
    rows.sort((a, b) => {
      const aVal = a[sort.key];
      const bVal = b[sort.key];
      const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [unitComparison, sort]);

  const maxChannelRevenue = Math.max(1, ...channelRevenue.map((c) => c.revenueInCents));

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Analytics</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
        <div>
          <label className="block text-xs text-neutral-500">Start</label>
          <input
            type="date"
            value={range.start}
            onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">End</label>
          <input
            type="date"
            value={range.end}
            onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
      </div>

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <MetricCard label="Room Revenue" value={formatCents(summary.totalRoomRevenueInCents)} />
          <MetricCard label="Occupancy" value={`${summary.occupancyRate.toFixed(1)}%`} />
          <MetricCard label="ADR" value={formatCents(summary.adrInCents)} />
          <MetricCard label="RevPAR" value={formatCents(summary.revParInCents)} />
          <MetricCard label="Booked Nights" value={String(summary.bookedNights)} />
          <MetricCard label="Available Nights" value={String(summary.availableNights)} />
          <MetricCard label="Avg Lead Time" value={`${avgLeadTimeDays.toFixed(1)} days`} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-neutral-200 p-3">
          <h2 className="mb-2 text-sm font-medium text-neutral-600">Daily revenue</h2>
          <AnalyticsChart
            data={daily.map((d) => ({ label: d.date.slice(5), value: d.revenueInCents }))}
            formatValue={formatCents}
            color="#0f172a"
          />
        </div>
        <div className="rounded-md border border-neutral-200 p-3">
          <h2 className="mb-2 text-sm font-medium text-neutral-600">Daily occupancy</h2>
          <AnalyticsChart
            data={daily.map((d) => ({ label: d.date.slice(5), value: d.occupancyRate }))}
            formatValue={(v) => `${v.toFixed(0)}%`}
            color="#2563eb"
          />
        </div>
      </div>

      <div className="mb-6 rounded-md border border-neutral-200 p-3">
        <h2 className="mb-3 text-sm font-medium text-neutral-600">Channel revenue breakdown</h2>
        <div className="space-y-2">
          {channelRevenue.map((c) => (
            <div key={c.channel} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-neutral-600">{CHANNEL_LABELS[c.channel]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-neutral-900"
                  style={{ width: `${(c.revenueInCents / maxChannelRevenue) * 100}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right tabular-nums text-neutral-700">{formatCents(c.revenueInCents)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 p-3">
        <h2 className="mb-3 text-sm font-medium text-neutral-600">Unit performance comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs text-neutral-500">
              <tr>
                {(
                  [
                    ["unitName", "Unit"],
                    ["totalBookings", "Bookings"],
                    ["roomRevenueInCents", "Revenue"],
                    ["occupancyPercent", "Occupancy"],
                    ["avgLeadTimeDays", "Avg Lead Time"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className="px-3 py-2 font-medium">
                    <button onClick={() => toggleSort(key)} className="flex items-center gap-1 hover:text-neutral-800">
                      {label}
                      {sort.key === key && (sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedUnitComparison.map((row) => (
                <tr key={row.unitId} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2">{row.unitName}</td>
                  <td className="px-3 py-2 tabular-nums">{row.totalBookings}</td>
                  <td className="px-3 py-2 tabular-nums">{formatCents(row.roomRevenueInCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.occupancyPercent.toFixed(1)}%</td>
                  <td className="px-3 py-2 tabular-nums">{row.avgLeadTimeDays.toFixed(1)} days</td>
                </tr>
              ))}
              {sortedUnitComparison.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-neutral-400">
                    No units yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
