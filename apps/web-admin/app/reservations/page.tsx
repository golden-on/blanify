"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";
import { ChannelBadge } from "@/components/ChannelBadge";
import { ReservationDetailDrawer, type ReservationDetail } from "@/components/ReservationDetailDrawer";

interface ReservationRow {
  id: string;
  unitId: string;
  unitName: string | null;
  checkIn: string;
  checkOut: string;
  status: string;
  guestName: string | null;
  guestEmail: string | null;
  channel: string | null;
  totalInCents: number;
  paidInCents: number;
}

interface Unit {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-200 text-neutral-500",
  checked_in: "bg-blue-100 text-blue-700",
  checked_out: "bg-purple-100 text-purple-700",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[status] ?? "bg-neutral-100 text-neutral-600"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function ReservationsPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReservationDetail | null>(null);

  const [filters, setFilters] = useState({ search: "", status: "", unitId: "", startDate: "", endDate: "" });

  const loadUnits = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ units: Unit[] }>("/api/v1/host/units", token);
      setUnits(body.units);
    } catch {
      // Non-fatal — the unit filter just stays empty.
    }
  }, [token]);

  const loadReservations = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.status) params.set("status", filters.status);
      if (filters.unitId) params.set("unitId", filters.unitId);
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);

      const body = await apiFetch<{ reservations: ReservationRow[] }>(`/api/v1/host/reservations?${params.toString()}`, token);
      setReservations(body.reservations);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reservations");
    }
  }, [token, filters]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  async function openDetail(reservationId: string) {
    if (!token) return;
    try {
      const reservationDetail = await apiFetch<ReservationDetail>(`/api/v1/host/reservations/${reservationId}`, token);
      setDetail(reservationDetail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reservation");
    }
  }

  function exportCsv() {
    const header = ["Guest", "Email", "Unit", "Check-in", "Check-out", "Channel", "Status", "Total"];
    const rows = reservations.map((r) => [
      r.guestName ?? "",
      r.guestEmail ?? "",
      r.unitName ?? "",
      r.checkIn,
      r.checkOut,
      r.channel ?? "",
      r.status,
      (r.totalInCents / 100).toFixed(2),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => csvEscape(String(cell))).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reservations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Reservations</h1>
        <button
          onClick={exportCsv}
          disabled={reservations.length === 0}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
        <div>
          <label className="block text-xs text-neutral-500">Search</label>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Guest name or email"
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Unit</label>
          <select
            value={filters.unitId}
            onChange={(e) => setFilters((f) => ({ ...f, unitId: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          >
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="checked_in">Checked in</option>
            <option value="checked_out">Checked out</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Start</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">End</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Guest</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Check-in</th>
              <th className="px-3 py-2 font-medium">Check-out</th>
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2">{r.guestName ?? "Unknown (no thread yet)"}</td>
                <td className="px-3 py-2">{r.unitName ?? "—"}</td>
                <td className="px-3 py-2">{r.checkIn}</td>
                <td className="px-3 py-2">{r.checkOut}</td>
                <td className="px-3 py-2">{r.channel ? <ChannelBadge channel={r.channel} /> : "—"}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-3 py-2 tabular-nums">{formatCents(r.totalInCents)}</td>
                <td className="px-3 py-2">
                  <button onClick={() => void openDetail(r.id)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50">
                    View
                  </button>
                </td>
              </tr>
            ))}
            {reservations.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-neutral-400">
                  No reservations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <ReservationDetailDrawer
          detail={detail}
          token={token}
          onClose={() => setDetail(null)}
          onCancelled={() => {
            setDetail(null);
            void loadReservations();
          }}
        />
      )}
    </div>
  );
}
