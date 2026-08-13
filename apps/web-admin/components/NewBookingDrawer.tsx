"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { SlideOver } from "./SlideOver";

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface NewBookingDrawerProps {
  token: string;
  units: Unit[];
  initialUnitId?: string;
  initialCheckIn?: string;
  onClose: () => void;
  onCreated: (reservationId: string) => void;
}

const CHANNELS = [
  { value: "direct", label: "Direct" },
  { value: "airbnb", label: "Airbnb" },
  { value: "booking_com", label: "Booking.com" },
  { value: "ical", label: "iCal" },
];

export function NewBookingDrawer({ token, units, initialUnitId, initialCheckIn, onClose, onCreated }: NewBookingDrawerProps) {
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [unitId, setUnitId] = useState(initialUnitId ?? units[0]?.id ?? "");
  const [channel, setChannel] = useState("direct");
  const [checkIn, setCheckIn] = useState(initialCheckIn ?? "");
  const [checkOut, setCheckOut] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!guestName || !unitId || !checkIn || !checkOut) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ reservation: { id: string } }>("/api/v1/host/reservations", token, {
        method: "POST",
        body: JSON.stringify({
          unitId,
          checkIn,
          checkOut,
          guestName,
          guestEmail: guestEmail || undefined,
          channel,
          totalPriceInCents: totalPrice ? Math.round(Number(totalPrice) * 100) : undefined,
        }),
      });
      onCreated(body.reservation.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create reservation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver title="New manual booking" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <label className="block text-xs text-neutral-500">Guest name</label>
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Guest email (optional)</label>
          <input
            type="email"
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
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
        <div>
          <label className="block text-xs text-neutral-500">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-neutral-500">Check-in</label>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-neutral-500">Check-out</label>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Custom total price (optional, overrides nightly rates)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
            placeholder="e.g. 350.00"
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !guestName || !unitId || !checkIn || !checkOut || checkOut <= checkIn}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create booking"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
