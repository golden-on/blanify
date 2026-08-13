"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SlideOver } from "./SlideOver";
import { ChannelBadge } from "./ChannelBadge";

export interface ReservationDetail {
  reservation: { id: string; checkIn: string; checkOut: string; status: string };
  payment: { status: string; amountInCents: number; currency: string } | null;
  guestName: string | null;
  channel: string | null;
  guestPortalUrl: string | null;
  cleaningTaskStatus: string | null;
}

export function ReservationDetailDrawer({ detail, onClose }: { detail: ReservationDetail; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyPortalUrl() {
    if (!detail.guestPortalUrl) return;
    await navigator.clipboard.writeText(detail.guestPortalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
    </SlideOver>
  );
}
