"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";
import { OnboardingWizard } from "@/components/OnboardingWizard";

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface Night {
  date: string;
  status: "available" | "booked" | "blocked";
  reservationId: string | null;
  priceInCents: number | null;
}

interface ReservationDetail {
  reservation: { id: string; checkIn: string; checkOut: string; status: string };
  payment: { status: string; amountInCents: number; currency: string } | null;
  guestName: string | null;
  channel: string | null;
}

const WINDOW_DAYS = 14;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusClasses(status: Night["status"] | undefined): string {
  switch (status) {
    case "booked":
      return "bg-blue-100 text-blue-800 hover:bg-blue-200";
    case "blocked":
      return "bg-neutral-300 text-neutral-600 hover:bg-neutral-400";
    case "available":
      return "bg-white text-neutral-700 hover:bg-green-50";
    default:
      return "bg-neutral-50 text-neutral-300";
  }
}

export default function CalendarPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [nightsByUnit, setNightsByUnit] = useState<Record<string, Record<string, Night>>>({});
  const [windowStart, setWindowStart] = useState(today());
  const [pendingRangeStart, setPendingRangeStart] = useState<{ unitId: string; date: string } | null>(null);
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i)), [windowStart]);
  const windowEnd = dates[dates.length - 1]!;

  const loadCalendar = useCallback(async () => {
    if (!token) return;
    try {
      const unitsResponse = await apiFetch<{ units: Unit[] }>("/api/v1/host/units", token);
      setUnits(unitsResponse.units);

      const entries = await Promise.all(
        unitsResponse.units.map(async (unit) => {
          const { nights } = await apiFetch<{ nights: Night[] }>(
            `/api/v1/host/units/${unit.id}/calendar?start=${windowStart}&end=${windowEnd}`,
            token,
          );
          const byDate: Record<string, Night> = {};
          for (const night of nights) byDate[night.date] = night;
          return [unit.id, byDate] as const;
        }),
      );
      setNightsByUnit(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load calendar");
    }
  }, [token, windowStart, windowEnd]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  async function handleCellClick(unitId: string, night: Night | undefined, date: string) {
    if (!token) return;
    setError(null);

    if (night?.status === "booked") {
      setPendingRangeStart(null);
      if (!night.reservationId) return;
      try {
        const reservationDetail = await apiFetch<ReservationDetail>(`/api/v1/host/reservations/${night.reservationId}`, token);
        setDetail(reservationDetail);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load reservation");
      }
      return;
    }

    if (night?.status === "blocked") {
      setPendingRangeStart(null);
      if (!window.confirm(`Unblock ${date} for this unit?`)) return;
      try {
        await apiFetch(`/api/v1/host/units/${unitId}/unblock`, token, {
          method: "POST",
          body: JSON.stringify({ dates: [date] }),
        });
        await loadCalendar();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to unblock date");
      }
      return;
    }

    // Available night: first click starts a range, a second click on the same unit
    // finishes it and confirms blocking every night in between.
    if (!pendingRangeStart || pendingRangeStart.unitId !== unitId) {
      setPendingRangeStart({ unitId, date });
      return;
    }

    const [start, end] = date >= pendingRangeStart.date ? [pendingRangeStart.date, date] : [date, pendingRangeStart.date];
    const rangeDates: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) rangeDates.push(d);
    setPendingRangeStart(null);

    if (!window.confirm(`Block ${rangeDates.length} night(s) from ${start} to ${end}?`)) return;
    try {
      await apiFetch(`/api/v1/host/units/${unitId}/block`, token, {
        method: "POST",
        body: JSON.stringify({ dates: rangeDates }),
      });
      await loadCalendar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to block dates");
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Calendar</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setWindowStart((d) => addDays(d, -WINDOW_DAYS))}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
          >
            Prev
          </button>
          <button
            onClick={() => setWindowStart((d) => addDays(d, WINDOW_DAYS))}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
          >
            Next
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {pendingRangeStart && (
        <p className="mb-3 text-sm text-neutral-500">
          Range start set at {pendingRangeStart.date} — click another available night on the same unit to block the range.
        </p>
      )}

      {units.length === 0 ? (
        token && <OnboardingWizard token={token} onComplete={() => void loadCalendar()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[160px] bg-white p-2 text-left font-medium">Unit</th>
                {dates.map((date) => (
                  <th key={date} className="min-w-[64px] p-2 text-center font-medium text-neutral-500">
                    {date.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id}>
                  <td className="sticky left-0 z-10 bg-white p-2 font-medium">
                    {unit.name}
                    <div className="text-xs font-normal text-neutral-400">{unit.propertyName}</div>
                  </td>
                  {dates.map((date) => {
                    const night = nightsByUnit[unit.id]?.[date];
                    const isPendingStart = pendingRangeStart?.unitId === unit.id && pendingRangeStart.date === date;
                    return (
                      <td key={date} className="p-1 text-center">
                        <button
                          onClick={() => void handleCellClick(unit.id, night, date)}
                          className={`h-9 w-14 rounded border border-neutral-200 text-xs ${statusClasses(night?.status)} ${
                            isPendingStart ? "ring-2 ring-neutral-900" : ""
                          }`}
                          title={night?.status ?? "no data"}
                        >
                          {night?.priceInCents ? `$${Math.round(night.priceInCents / 100)}` : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="fixed inset-y-0 right-0 w-80 border-l border-neutral-200 bg-white p-5 shadow-lg">
          <button onClick={() => setDetail(null)} className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700">
            <X size={18} />
          </button>
          <h2 className="mb-4 text-base font-semibold">Reservation</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-neutral-400">Guest</dt>
              <dd>{detail.guestName ?? "Unknown (no thread yet)"}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Channel</dt>
              <dd>{detail.channel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Dates</dt>
              <dd>
                {detail.reservation.checkIn} → {detail.reservation.checkOut}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-400">Payment status</dt>
              <dd>{detail.payment ? `${detail.payment.status} ($${(detail.payment.amountInCents / 100).toFixed(2)})` : "No payment recorded"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
