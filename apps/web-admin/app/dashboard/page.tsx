"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Inbox, LogIn, LogOut, Users } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";
import { ReservationDetailDrawer, type ReservationDetail } from "@/components/ReservationDetailDrawer";

interface DashboardChecklist {
  hasUnits: boolean;
  hasStripeConnected: boolean;
  hasTaxRules: boolean;
  hasWebsitePublished: boolean;
  hasChannelsConnected: boolean;
}

interface DashboardActivityReservation {
  id: string;
  unitName: string | null;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
}

interface DashboardTodaysActivity {
  checkIns: DashboardActivityReservation[];
  checkOuts: DashboardActivityReservation[];
  currentlyStaying: DashboardActivityReservation[];
}

interface DashboardKpis {
  activeReservationsCount: number;
  occupancyRateThisMonth: number;
  revenueThisMonthInCents: number;
  openThreadsCount: number;
}

interface Dashboard {
  checklist: DashboardChecklist;
  today: DashboardTodaysActivity;
  kpis: DashboardKpis;
}

const CHECKLIST_ITEMS: { key: keyof DashboardChecklist; label: string; href: string }[] = [
  { key: "hasUnits", label: "Add your first unit", href: "/calendar" },
  { key: "hasStripeConnected", label: "Connect Stripe", href: "/settings" },
  { key: "hasTaxRules", label: "Set up tax rules", href: "/settings" },
  { key: "hasWebsitePublished", label: "Publish your booking website", href: "/website" },
  { key: "hasChannelsConnected", label: "Connect a channel", href: "/channels" },
];

const COLLAPSE_STORAGE_KEY = "dashboard_checklist_collapsed";

const ACTIVITY_TABS: { key: keyof DashboardTodaysActivity; label: string }[] = [
  { key: "checkIns", label: "Check-ins" },
  { key: "checkOuts", label: "Check-outs" },
  { key: "currentlyStaying", label: "Current Guests" },
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<keyof DashboardTodaysActivity>("checkIns");
  const [detail, setDetail] = useState<ReservationDetail | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<Dashboard>("/api/v1/host/dashboard", token);
      setDashboard(body);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load dashboard");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
    } catch {
      // localStorage unavailable (e.g. private browsing) — default to expanded.
    }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
    } catch {
      // Non-fatal — the preference just won't persist across reloads.
    }
  }

  async function openDetail(reservationId: string) {
    if (!token) return;
    try {
      const reservationDetail = await apiFetch<ReservationDetail>(`/api/v1/host/reservations/${reservationId}`, token);
      setDetail(reservationDetail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reservation");
    }
  }

  if (!dashboard) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-lg font-semibold">Dashboard</h1>
        {error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-neutral-400">Loading...</p>}
      </div>
    );
  }

  const { checklist, today, kpis } = dashboard;
  const completedCount = CHECKLIST_ITEMS.filter((item) => checklist[item.key]).length;
  const isComplete = completedCount === CHECKLIST_ITEMS.length;
  const activeList = today[activeTab];

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Dashboard</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {!isComplete && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          {collapsed ? (
            <button onClick={toggleCollapsed} className="flex w-full items-center justify-between text-sm font-medium text-amber-900">
              <span>
                {completedCount}/{CHECKLIST_ITEMS.length} setup steps complete — Show checklist
              </span>
              <ChevronDown size={16} />
            </button>
          ) : (
            <>
              <button onClick={toggleCollapsed} className="mb-3 flex w-full items-center justify-between text-sm font-medium text-amber-900">
                <span>Finish setting up your property ({completedCount}/{CHECKLIST_ITEMS.length})</span>
                <ChevronUp size={16} />
              </button>
              <ul className="space-y-2">
                {CHECKLIST_ITEMS.map((item) => {
                  const done = checklist[item.key];
                  return (
                    <li key={item.key} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full ${
                            done ? "bg-emerald-500 text-white" : "border border-amber-400"
                          }`}
                        >
                          {done && <Check size={10} />}
                        </span>
                        <span className={done ? "text-neutral-500 line-through" : "text-neutral-800"}>{item.label}</span>
                      </span>
                      {!done && (
                        <Link href={item.href} className="text-xs font-medium text-amber-900 hover:underline">
                          Fix now →
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Monthly Revenue" value={formatCents(kpis.revenueThisMonthInCents)} />
        <MetricCard label="Occupancy Rate" value={`${kpis.occupancyRateThisMonth.toFixed(1)}%`} />
        <MetricCard label="Active Bookings" value={String(kpis.activeReservationsCount)} />
        <MetricCard label="Open Inbox" value={String(kpis.openThreadsCount)} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/calendar?action=new-booking" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800">
          New Booking
        </Link>
        <Link href="/calendar?action=block-dates" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
          Block Dates
        </Link>
        <Link href="/inbox" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
          View Inbox
        </Link>
      </div>

      <div className="rounded-md border border-neutral-200">
        <div className="flex border-b border-neutral-200">
          {ACTIVITY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium ${
                activeTab === tab.key ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {tab.key === "checkIns" && <LogIn size={14} />}
              {tab.key === "checkOuts" && <LogOut size={14} />}
              {tab.key === "currentlyStaying" && <Users size={14} />}
              {tab.label}
              <span className="rounded-full bg-neutral-100 px-1.5 text-xs text-neutral-600">{today[tab.key].length}</span>
            </button>
          ))}
        </div>
        <div className="divide-y divide-neutral-100">
          {activeList.length === 0 && <p className="p-4 text-sm text-neutral-400">Nothing here today.</p>}
          {activeList.map((r) => (
            <button key={r.id} onClick={() => void openDetail(r.id)} className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-neutral-50">
              <span>
                <span className="font-medium">{r.guestName ?? "Unknown (no thread yet)"}</span>
                <span className="text-neutral-400"> — {r.unitName ?? "—"}</span>
              </span>
              <span className="text-xs text-neutral-400">
                {r.checkIn} → {r.checkOut}
              </span>
            </button>
          ))}
        </div>
      </div>

      {today.checkIns.length === 0 && today.checkOuts.length === 0 && today.currentlyStaying.length === 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-neutral-400">
          <Inbox size={12} /> No activity scheduled for today across any list.
        </p>
      )}

      {detail && <ReservationDetailDrawer detail={detail} token={token} onClose={() => setDetail(null)} onCancelled={() => { setDetail(null); void load(); }} />}
    </div>
  );
}
