"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError, API_BASE_URL } from "@/lib/api";
import { SlideOver } from "@/components/SlideOver";

type ChannelName = "airbnb" | "booking" | "google_vacation_rentals" | "ical";
type ChannelStatusValue = "connected" | "error" | "disconnected" | "not_connected";

interface ChannelStatus {
  channel: ChannelName;
  status: ChannelStatusValue;
  lastSyncedAt: string | null;
}

interface IcalFeed {
  id: string;
  unitId: string;
  unitName: string;
  name: string;
  url: string;
  syncStatus: "pending" | "success" | "failed";
  errorMessage: string | null;
  lastSyncedAt: string | null;
}

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

const CHANNEL_LABELS: Record<ChannelName, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  google_vacation_rentals: "Google Vacation Rentals",
  ical: "iCal",
};

const STATUS_STYLES: Record<ChannelStatusValue, string> = {
  connected: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  disconnected: "bg-neutral-200 text-neutral-700",
  not_connected: "bg-neutral-100 text-neutral-500",
};

const STATUS_LABELS: Record<ChannelStatusValue, string> = {
  connected: "Connected",
  error: "Error",
  disconnected: "Disconnected",
  not_connected: "Not connected",
};

function formatTimestamp(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button onClick={() => void copy()} className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function ChannelsPage() {
  const { session } = useSession();
  const token = session?.token ?? null;
  const accountId = session?.accountId ?? null;

  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [icalFeeds, setIcalFeeds] = useState<IcalFeed[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ channels: ChannelStatus[]; icalFeeds: IcalFeed[] }>("/api/v1/host/channels", token);
      setChannels(body.channels);
      setIcalFeeds(body.icalFeeds);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load channels");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ units: Unit[] }>("/api/v1/host/units", token)
      .then((body) => setUnits(body.units))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load units"));
  }, [token]);

  async function syncNow() {
    if (!token) return;
    setSyncing(true);
    setError(null);
    try {
      await apiFetch("/api/v1/host/channels/sync", token, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to trigger sync");
    } finally {
      setSyncing(false);
    }
  }

  async function removeFeed(feedId: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/v1/host/channels/ical-feeds/${feedId}`, token, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete feed");
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Channels</h1>
        <button
          onClick={() => void syncNow()}
          disabled={syncing}
          className="flex items-center gap-1 rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncing && <Loader2 size={14} className="animate-spin" />}
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {channels.map((c) => (
          <div key={c.channel} className="rounded-md border border-neutral-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{CHANNEL_LABELS[c.channel]}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[c.status]}`}>{STATUS_LABELS[c.status]}</span>
            </div>
            <div className="text-xs text-neutral-500">Last synced: {formatTimestamp(c.lastSyncedAt)}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">iCal Feeds</h2>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
        >
          <Plus size={14} /> Import feed
        </button>
      </div>

      <table className="mb-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="p-2">Unit</th>
            <th className="p-2">Feed name</th>
            <th className="p-2">Source URL</th>
            <th className="p-2">Status</th>
            <th className="p-2">Last synced</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {icalFeeds.map((feed) => (
            <tr key={feed.id} className="border-b border-neutral-100">
              <td className="p-2">{feed.unitName}</td>
              <td className="p-2">{feed.name}</td>
              <td className="max-w-xs truncate p-2 text-xs text-neutral-500" title={feed.url}>
                {feed.url}
              </td>
              <td className="p-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    feed.syncStatus === "success" ? "bg-green-100 text-green-800" : feed.syncStatus === "failed" ? "bg-red-100 text-red-800" : "bg-neutral-200 text-neutral-700"
                  }`}
                  title={feed.errorMessage ?? undefined}
                >
                  {feed.syncStatus}
                </span>
              </td>
              <td className="p-2 text-xs text-neutral-500">{formatTimestamp(feed.lastSyncedAt)}</td>
              <td className="p-2 text-right">
                <button onClick={() => void removeFeed(feed.id)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {icalFeeds.length === 0 && (
            <tr>
              <td colSpan={6} className="p-3 text-sm text-neutral-400">
                No inbound iCal feeds yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-4 text-sm font-semibold text-neutral-700">Export URLs</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="p-2">Unit</th>
            <th className="p-2">Export .ics URL</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => {
            const url = `${API_BASE_URL}/api/v1/public/units/${unit.id}/calendar.ics?accountId=${accountId}`;
            return (
              <tr key={unit.id} className="border-b border-neutral-100">
                <td className="p-2">
                  {unit.name} <span className="text-xs text-neutral-400">({unit.propertyName})</span>
                </td>
                <td className="max-w-md truncate p-2 text-xs text-neutral-500" title={url}>
                  {url}
                </td>
                <td className="p-2 text-right">
                  <CopyButton value={url} />
                </td>
              </tr>
            );
          })}
          {units.length === 0 && (
            <tr>
              <td colSpan={3} className="p-3 text-sm text-neutral-400">
                No units yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showImport && token && (
        <ImportFeedDrawer
          token={token}
          units={units}
          onClose={() => setShowImport(false)}
          onCreated={() => {
            setShowImport(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ImportFeedDrawer({
  token,
  units,
  onClose,
  onCreated,
}: {
  token: string;
  units: Unit[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!unitId || !name || !url) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/v1/host/channels/ical-feeds", token, {
        method: "POST",
        body: JSON.stringify({ unitId, name, url }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to import feed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver title="Import iCal feed" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <label className="block text-xs text-neutral-500">Unit</label>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="w-full rounded-md border border-neutral-300 p-1.5 text-sm">
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.propertyName})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Feed name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Airbnb calendar"
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Feed URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.airbnb.com/calendar/ical/....ics"
            className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !unitId || !name || !url}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Importing..." : "Import feed"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
