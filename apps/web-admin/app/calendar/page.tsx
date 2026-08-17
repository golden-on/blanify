"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { ChannelBadge } from "@/components/ChannelBadge";
import { ClosedPeriodDrawer } from "@/components/ClosedPeriodDrawer";
import { NewBookingDrawer } from "@/components/NewBookingDrawer";
import { ReservationDetailDrawer, type ReservationDetail } from "@/components/ReservationDetailDrawer";

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
  guestName: string | null;
  channel: string | null;
  blockReason: string | null;
}

interface Task {
  id: string;
  unitId: string;
  taskType: "cleaning" | "maintenance" | "inspection";
  status: "pending" | "in_progress" | "completed" | "verified";
  dueAt: string;
}

type ViewMode = "reservations" | "tasks";

const WINDOW_DAYS = 14;
const GRID_TEMPLATE = `160px repeat(${WINDOW_DAYS}, minmax(64px, 1fr))`;

const TASK_STATUS_STYLES: Record<Task["status"], string> = {
  pending: "bg-neutral-200 text-neutral-700",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  verified: "bg-blue-100 text-blue-800",
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blockedClasses(): string {
  return "bg-neutral-300 text-neutral-600 hover:bg-neutral-400";
}

export default function CalendarPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoaded, setUnitsLoaded] = useState(false);
  const [nightsByUnit, setNightsByUnit] = useState<Record<string, Record<string, Night>>>({});
  const [tasksByUnit, setTasksByUnit] = useState<Record<string, Record<string, Task[]>>>({});
  const [windowStart, setWindowStart] = useState(today());
  const [unitFilter, setUnitFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("reservations");
  const [pendingRangeStart, setPendingRangeStart] = useState<{ unitId: string; date: string } | null>(null);
  const [closedPeriodDraft, setClosedPeriodDraft] = useState<{ unitId: string; start: string; end: string } | null>(null);
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i)), [windowStart]);
  const windowEnd = dates[dates.length - 1]!;
  const filteredUnits = useMemo(() => (unitFilter ? units.filter((u) => u.id === unitFilter) : units), [units, unitFilter]);

  const loadCalendar = useCallback(async () => {
    if (!token) return;
    try {
      const unitsResponse = await apiFetch<{ units: Unit[] }>("/api/v1/host/units", token);
      setUnits(unitsResponse.units);
      setUnitsLoaded(true);

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
      setUnitsLoaded(true);
    }
  }, [token, windowStart, windowEnd]);

  const loadTasks = useCallback(async () => {
    if (!token) return;
    try {
      const { tasks } = await apiFetch<{ tasks: Task[] }>("/api/v1/host/tasks", token);
      const byUnit: Record<string, Record<string, Task[]>> = {};
      for (const task of tasks) {
        const date = task.dueAt.slice(0, 10);
        byUnit[task.unitId] ??= {};
        (byUnit[task.unitId]![date] ??= []).push(task);
      }
      setTasksByUnit(byUnit);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tasks");
    }
  }, [token]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    if (viewMode === "tasks") void loadTasks();
  }, [viewMode, loadTasks]);

  // Dashboard "Quick Actions" deep-link into this page's existing drawers instead of
  // duplicating booking/blocking UI there (see Phase 16 plan Decision 8). Reads the raw
  // query string in an effect rather than useSearchParams() to avoid forcing this
  // otherwise-static page into a Suspense boundary at build time.
  useEffect(() => {
    if (!unitsLoaded || units.length === 0) return;
    const action = new URLSearchParams(window.location.search).get("action");
    if (!action) return;

    if (action === "new-booking") {
      setShowNewBooking(true);
    } else if (action === "block-dates") {
      setClosedPeriodDraft({ unitId: units[0]!.id, start: today(), end: today() });
    }
    window.history.replaceState(null, "", "/calendar");
  }, [unitsLoaded, units]);

  async function openReservationDetail(reservationId: string) {
    if (!token) return;
    try {
      const reservationDetail = await apiFetch<ReservationDetail>(`/api/v1/host/reservations/${reservationId}`, token);
      setDetail(reservationDetail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reservation");
    }
  }

  async function handleCellClick(unitId: string, night: Night | undefined, date: string) {
    if (!token) return;
    setError(null);

    if (night?.status === "booked") {
      setPendingRangeStart(null);
      if (night.reservationId) await openReservationDetail(night.reservationId);
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
    // opens the Closed Period drawer pre-filled with the computed range.
    if (!pendingRangeStart || pendingRangeStart.unitId !== unitId) {
      setPendingRangeStart({ unitId, date });
      return;
    }

    const [start, end] = date >= pendingRangeStart.date ? [pendingRangeStart.date, date] : [date, pendingRangeStart.date];
    setPendingRangeStart(null);
    setClosedPeriodDraft({ unitId, start, end });
  }

  function freeCountForDate(date: string): number {
    // A unit with no nightly_availability row yet for this date has never been booked
    // or blocked, so it's implicitly available — only an explicit "booked"/"blocked"
    // status should count against the free total.
    return filteredUnits.filter((u) => {
      const status = nightsByUnit[u.id]?.[date]?.status;
      return status === undefined || status === "available";
    }).length;
  }

  interface Segment {
    date: string;
    span: number;
    night: Night | undefined;
  }

  function buildSegments(unitId: string): Segment[] {
    const nightsForUnit = nightsByUnit[unitId] ?? {};
    const segments: Segment[] = [];
    let i = 0;
    while (i < dates.length) {
      const night = nightsForUnit[dates[i]!];
      if (night?.status === "booked" && night.reservationId) {
        let j = i;
        while (j + 1 < dates.length && nightsForUnit[dates[j + 1]!]?.reservationId === night.reservationId) j++;
        segments.push({ date: dates[i]!, span: j - i + 1, night });
        i = j + 1;
      } else {
        segments.push({ date: dates[i]!, span: 1, night });
        i++;
      }
    }
    return segments;
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-neutral-300 text-sm">
            <button
              onClick={() => setViewMode("reservations")}
              className={`rounded-l-md px-3 py-1 ${viewMode === "reservations" ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
            >
              Reservations
            </button>
            <button
              onClick={() => setViewMode("tasks")}
              className={`rounded-r-md px-3 py-1 ${viewMode === "tasks" ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
            >
              Housekeeping Tasks
            </button>
          </div>
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">All units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
          <input
            type="month"
            value={windowStart.slice(0, 7)}
            onChange={(e) => setWindowStart(`${e.target.value}-01`)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            onClick={() => setWindowStart(today())}
            className="flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
          >
            <CalendarDays size={14} />
            Today
          </button>
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
          <button
            onClick={() => setShowNewBooking(true)}
            className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-800"
          >
            <Plus size={14} />
            New booking
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {pendingRangeStart && (
        <p className="mb-3 text-sm text-neutral-500">
          Range start set at {pendingRangeStart.date} — click another available night on the same unit to choose the end date.
        </p>
      )}

      {!unitsLoaded ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading calendar">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-md bg-neutral-100" />
          ))}
        </div>
      ) : units.length === 0 ? (
        token && <OnboardingWizard token={token} onComplete={() => void loadCalendar()} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            <div className="grid items-center" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
              <div className="sticky left-0 z-10 bg-white p-2 text-left text-sm font-medium">Unit</div>
              {dates.map((date) => (
                <div key={date} className="p-1 text-center">
                  <div className="text-sm font-medium text-neutral-500">{date.slice(5)}</div>
                  {viewMode === "reservations" && (
                    <div className="text-[10px] text-neutral-400">⟳ {freeCountForDate(date)} free</div>
                  )}
                </div>
              ))}
            </div>

            {filteredUnits.map((unit) => (
              <div key={unit.id} className="grid items-center border-t border-neutral-100" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
                <div className="sticky left-0 z-10 bg-white p-2">
                  <Link href={`/units/${unit.id}`} className="text-sm font-medium hover:underline">
                    {unit.name}
                  </Link>
                  <div className="text-xs text-neutral-400">{unit.propertyName}</div>
                </div>

                {viewMode === "tasks"
                  ? dates.map((date) => {
                      const dayTasks = tasksByUnit[unit.id]?.[date] ?? [];
                      return (
                        <div key={date} className="p-1 text-center">
                          {dayTasks.length === 0 ? (
                            <div className="h-9" />
                          ) : (
                            <div
                              title={dayTasks.map((t) => `${t.taskType}: ${t.status}`).join(", ")}
                              className={`flex h-9 items-center justify-center rounded text-[10px] font-medium ${TASK_STATUS_STYLES[dayTasks[0]!.status]}`}
                            >
                              {dayTasks[0]!.taskType.slice(0, 4)}
                              {dayTasks.length > 1 ? ` +${dayTasks.length - 1}` : ""}
                            </div>
                          )}
                        </div>
                      );
                    })
                  : buildSegments(unit.id).map((segment) => {
                      const isPendingStart = pendingRangeStart?.unitId === unit.id && pendingRangeStart.date === segment.date;

                      if (segment.night?.status === "booked" && segment.span > 1) {
                        return (
                          <button
                            key={segment.date}
                            onClick={() => void handleCellClick(unit.id, segment.night, segment.date)}
                            style={{ gridColumn: `span ${segment.span}` }}
                            className="m-0.5 flex h-9 items-center gap-1 overflow-hidden rounded bg-blue-100 px-2 text-left text-xs text-blue-900 hover:bg-blue-200"
                          >
                            <span className="truncate font-medium">{segment.night.guestName ?? "Guest"}</span>
                            {segment.night.channel && <ChannelBadge channel={segment.night.channel} />}
                          </button>
                        );
                      }

                      const night = segment.night;
                      return (
                        <div key={segment.date} className="p-1 text-center">
                          <button
                            onClick={() => void handleCellClick(unit.id, night, segment.date)}
                            title={night?.status === "blocked" ? (night.blockReason ?? "Blocked") : (night?.status ?? "no data")}
                            className={`h-9 w-full rounded border border-neutral-200 text-xs ${
                              night?.status === "blocked" ? blockedClasses() : "bg-white text-neutral-700 hover:bg-green-50"
                            } ${isPendingStart ? "ring-2 ring-neutral-900" : ""}`}
                          >
                            {night?.status !== "blocked" && night?.priceInCents ? `$${Math.round(night.priceInCents / 100)}` : ""}
                          </button>
                        </div>
                      );
                    })}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded border border-neutral-200 bg-white" /> Available
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-blue-100" /> Booked
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-neutral-300" /> Blocked
            </span>
            <ChannelBadge channel="airbnb" />
            <ChannelBadge channel="booking_com" />
            <ChannelBadge channel="direct" />
            <ChannelBadge channel="ical" />
          </div>
        </div>
      )}

      {detail && (
        <ReservationDetailDrawer
          detail={detail}
          token={token}
          onClose={() => setDetail(null)}
          onCancelled={() => {
            setDetail(null);
            void loadCalendar();
          }}
        />
      )}

      {closedPeriodDraft && token && (
        <ClosedPeriodDrawer
          token={token}
          units={units}
          initialUnitId={closedPeriodDraft.unitId}
          initialStart={closedPeriodDraft.start}
          initialEnd={closedPeriodDraft.end}
          onClose={() => setClosedPeriodDraft(null)}
          onCreated={() => {
            setClosedPeriodDraft(null);
            void loadCalendar();
          }}
        />
      )}

      {showNewBooking && token && (
        <NewBookingDrawer
          token={token}
          units={units}
          onClose={() => setShowNewBooking(false)}
          onCreated={(reservationId) => {
            setShowNewBooking(false);
            void loadCalendar();
            void openReservationDetail(reservationId);
          }}
        />
      )}
    </div>
  );
}
