"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SlideOver } from "./SlideOver";
import { ChannelBadge } from "./ChannelBadge";
import { apiFetch, ApiError } from "@/lib/api";

export interface ReservationFinancials {
  lineItems: { label: string; amountInCents: number }[];
  subtotalInCents: number;
  taxInCents: number;
  totalInCents: number;
  paidInCents: number;
  dueInCents: number;
  depositCapturedInCents: number;
}

export interface ReservationDetail {
  reservation: { id: string; checkIn: string; checkOut: string; status: string };
  unitName: string | null;
  payment: { status: string; amountInCents: number; currency: string } | null;
  guestName: string | null;
  guestEmail: string | null;
  channel: string | null;
  guestPortalUrl: string | null;
  cleaningTaskStatus: string | null;
  financials: ReservationFinancials;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ReservationDetailDrawer({
  detail,
  token,
  onClose,
  onCancelled,
}: {
  detail: ReservationDetail;
  token: string | null;
  onClose: () => void;
  onCancelled?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [refundOnCancel, setRefundOnCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function copyPortalUrl() {
    if (!detail.guestPortalUrl) return;
    await navigator.clipboard.writeText(detail.guestPortalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function confirmCancel() {
    if (!token) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await apiFetch(`/api/v1/host/reservations/${detail.reservation.id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ refund: refundOnCancel }),
      });
      onCancelled?.();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Failed to cancel reservation");
    } finally {
      setIsCancelling(false);
    }
  }

  const isCancelled = detail.reservation.status === "cancelled";

  return (
    <SlideOver title="Reservation" onClose={onClose}>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-neutral-400">Guest</dt>
          <dd className="flex items-center gap-2">
            {detail.guestName ?? "Unknown (no thread yet)"}
            {detail.channel && <ChannelBadge channel={detail.channel} />}
          </dd>
        </div>
        {detail.guestEmail && (
          <div>
            <dt className="text-neutral-400">Email</dt>
            <dd>{detail.guestEmail}</dd>
          </div>
        )}
        <div>
          <dt className="text-neutral-400">Unit</dt>
          <dd>{detail.unitName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Dates</dt>
          <dd>
            {detail.reservation.checkIn} → {detail.reservation.checkOut}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">Status</dt>
          <dd className="capitalize">{detail.reservation.status}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Payment status</dt>
          <dd>{detail.payment ? `${detail.payment.status} (${formatCents(detail.payment.amountInCents)})` : "No payment recorded"}</dd>
        </div>
        {detail.financials.depositCapturedInCents > 0 && (
          <div>
            <dt className="text-neutral-400">Deposit captured</dt>
            <dd>{formatCents(detail.financials.depositCapturedInCents)}</dd>
          </div>
        )}
        <div>
          <dt className="mb-1 text-neutral-400">Itemized breakdown</dt>
          <dd>
            <div className="space-y-1 rounded-md border border-neutral-200 p-2">
              {detail.financials.lineItems.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span>{item.label}</span>
                  <span className="tabular-nums">{formatCents(item.amountInCents)}</span>
                </div>
              ))}
              {detail.financials.taxInCents > 0 && (
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span className="tabular-nums">{formatCents(detail.financials.taxInCents)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-neutral-200 pt-1 font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatCents(detail.financials.totalInCents)}</span>
              </div>
              <div className="flex justify-between text-neutral-500">
                <span>Paid</span>
                <span className="tabular-nums">{formatCents(detail.financials.paidInCents)}</span>
              </div>
              <div className="flex justify-between text-neutral-500">
                <span>Due</span>
                <span className="tabular-nums">{formatCents(detail.financials.dueInCents)}</span>
              </div>
            </div>
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">Cleaning task</dt>
          <dd>{detail.cleaningTaskStatus ?? "Not scheduled yet"}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Guest portal</dt>
          <dd>
            {detail.guestPortalUrl ? (
              <button
                onClick={() => void copyPortalUrl()}
                className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy link"}
              </button>
            ) : (
              "Not available yet"
            )}
          </dd>
        </div>
      </dl>

      {!isCancelled && (
        <div className="mt-5 border-t border-neutral-200 pt-4">
          {cancelError && <p className="mb-2 text-xs text-red-600">{cancelError}</p>}
          {!showCancelConfirm ? (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="w-full rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Cancel Reservation
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-red-200 p-3">
              <p className="text-xs text-neutral-600">
                This releases the booked nights back to availability and marks the reservation cancelled.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={refundOnCancel} onChange={(e) => setRefundOnCancel(e.target.checked)} />
                Also refund the guest&apos;s payment
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => void confirmCancel()}
                  disabled={isCancelling}
                  className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {isCancelling ? "Cancelling..." : "Confirm cancellation"}
                </button>
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isCancelling}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SlideOver>
  );
}
