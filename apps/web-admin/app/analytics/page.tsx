"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ summary: AnalyticsSummary; daily: DailyAnalyticsPoint[] }>(
        `/api/v1/host/analytics?start=${range.start}&end=${range.end}`,
        token,
      );
      setSummary(body.summary);
      setDaily(body.daily);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load analytics");
    }
  }, [token, range]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Room Revenue" value={formatCents(summary.totalRoomRevenueInCents)} />
          <MetricCard label="Occupancy" value={`${summary.occupancyRate.toFixed(1)}%`} />
          <MetricCard label="ADR" value={formatCents(summary.adrInCents)} />
          <MetricCard label="RevPAR" value={formatCents(summary.revParInCents)} />
          <MetricCard label="Booked Nights" value={String(summary.bookedNights)} />
          <MetricCard label="Available Nights" value={String(summary.availableNights)} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
    </div>
  );
}
