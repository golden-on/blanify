"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { SlideOver } from "./SlideOver";

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface ClosedPeriodDrawerProps {
  token: string;
  units: Unit[];
  initialUnitId: string;
  initialStart: string;
  initialEnd: string;
  onClose: () => void;
  onCreated: () => void;
}

// Inclusive on both ends — this mirrors the calendar's existing two-click range-select
// behavior, which blocks exactly the two clicked cells and everything between them.
function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = start; d <= end; ) {
    dates.push(d);
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return dates;
}

export function ClosedPeriodDrawer({ token, units, initialUnitId, initialStart, initialEnd, onClose, onCreated }: ClosedPeriodDrawerProps) {
  const [unitId, setUnitId] = useState(initialUnitId);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!unitId || !start || !end) return;
    setSubmitting(true);
    setError(null);
    try {
      const dates = datesInRange(start, end);
      await apiFetch(`/api/v1/host/units/${unitId}/block`, token, {
        method: "POST",
        body: JSON.stringify({ dates, reason: reason || undefined }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create closed period");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver title="Create closed period" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <label className="block text-xs text-neutral-500">Unit</label>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.propertyName})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-neutral-500">Start date</label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-neutral-500">End date</label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
            placeholder="Owner staying, maintenance, ..."
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !unitId || !start || !end || end < start}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Blocking..." : "Block dates"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
