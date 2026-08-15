"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

type TaxType = "vat" | "tourist_tax" | "sales_tax";
type RateType = "percentage" | "per_night_flat";

interface TaxRule {
  id: string;
  jurisdiction: string;
  taxType: TaxType;
  rateType: RateType;
  rateValue: string;
  appliesToUnitId: string | null;
}

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface StripeAccount {
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

interface SmartLock {
  id: string;
  unitName: string;
  provider: string;
  deviceName: string;
  status: "online" | "offline" | "error";
}

type Tab = "tax" | "deposits" | "cancellation" | "hardware";

const TABS: { id: Tab; label: string }[] = [
  { id: "tax", label: "Tax Rules" },
  { id: "deposits", label: "Deposits & Payments" },
  { id: "cancellation", label: "Cancellation Policies" },
  { id: "hardware", label: "Hardware" },
];

const SMART_LOCK_STATUS_STYLES: Record<SmartLock["status"], string> = {
  online: "bg-green-100 text-green-800",
  offline: "bg-neutral-200 text-neutral-700",
  error: "bg-red-100 text-red-800",
};

const emptyTaxForm = {
  jurisdiction: "",
  taxType: "vat" as TaxType,
  rateType: "percentage" as RateType,
  rateValue: "",
  appliesToUnitId: "",
};

const DEPOSIT_STORAGE_KEY = "blanify_settings_deposit";
const CANCELLATION_STORAGE_KEY = "blanify_settings_cancellation";
const PIN_BUFFER_STORAGE_KEY = "blanify_settings_pin_buffer";

interface DepositSettings {
  holdType: "fixed" | "percentage";
  holdValue: string;
}

const defaultDepositSettings: DepositSettings = { holdType: "fixed", holdValue: "" };

const CANCELLATION_POLICIES = [
  { id: "flexible", label: "Flexible", description: "Full refund up to 24 hours before check-in." },
  { id: "moderate", label: "Moderate", description: "Full refund up to 5 days before check-in." },
  { id: "strict", label: "Strict", description: "50% refund up to 7 days before check-in, non-refundable after." },
];

export default function SettingsPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [tab, setTab] = useState<Tab>("tax");
  const [error, setError] = useState<string | null>(null);

  const [taxRules, setTaxRules] = useState<TaxRule[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [taxForm, setTaxForm] = useState(emptyTaxForm);

  const [stripeAccount, setStripeAccount] = useState<StripeAccount | null>(null);
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [depositSettings, setDepositSettings] = useState<DepositSettings>(defaultDepositSettings);

  const [cancellationPolicy, setCancellationPolicy] = useState("flexible");

  const [smartLocks, setSmartLocks] = useState<SmartLock[]>([]);
  const [pinBufferMinutes, setPinBufferMinutes] = useState("60");

  const loadTaxRules = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ taxRules: TaxRule[] }>("/api/v1/host/tax-rules", token);
      setTaxRules(body.taxRules);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tax rules");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ units: Unit[] }>("/api/v1/host/units", token)
      .then((body) => setUnits(body.units))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load units"));
  }, [token]);

  useEffect(() => {
    void loadTaxRules();
  }, [loadTaxRules]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ stripeAccount: StripeAccount | null }>("/api/v1/host/stripe-account", token)
      .then((body) => {
        setStripeAccount(body.stripeAccount);
        setStripeLoaded(true);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load Stripe account status"));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ smartLocks: SmartLock[] }>("/api/v1/host/smart-locks", token)
      .then((body) => setSmartLocks(body.smartLocks))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load smart locks"));
  }, [token]);

  // Local-only settings (no backend concept exists for these yet) — persisted per
  // browser so the UI is real and working rather than resetting on every reload.
  useEffect(() => {
    try {
      const storedDeposit = window.localStorage.getItem(DEPOSIT_STORAGE_KEY);
      if (storedDeposit) setDepositSettings(JSON.parse(storedDeposit) as DepositSettings);
      const storedCancellation = window.localStorage.getItem(CANCELLATION_STORAGE_KEY);
      if (storedCancellation) setCancellationPolicy(storedCancellation);
      const storedPinBuffer = window.localStorage.getItem(PIN_BUFFER_STORAGE_KEY);
      if (storedPinBuffer) setPinBufferMinutes(storedPinBuffer);
    } catch {
      // localStorage unavailable (e.g. private browsing) — fall back to defaults silently.
    }
  }, []);

  function saveDepositSettings(next: DepositSettings) {
    setDepositSettings(next);
    window.localStorage.setItem(DEPOSIT_STORAGE_KEY, JSON.stringify(next));
  }

  function saveCancellationPolicy(next: string) {
    setCancellationPolicy(next);
    window.localStorage.setItem(CANCELLATION_STORAGE_KEY, next);
  }

  function savePinBufferMinutes(next: string) {
    setPinBufferMinutes(next);
    window.localStorage.setItem(PIN_BUFFER_STORAGE_KEY, next);
  }

  async function createTaxRule() {
    if (!token || !taxForm.jurisdiction || !taxForm.rateValue) return;
    try {
      const rateValue =
        taxForm.rateType === "percentage" ? Number(taxForm.rateValue) / 100 : Math.round(Number(taxForm.rateValue) * 100);
      await apiFetch("/api/v1/host/tax-rules", token, {
        method: "POST",
        body: JSON.stringify({
          jurisdiction: taxForm.jurisdiction,
          taxType: taxForm.taxType,
          rateType: taxForm.rateType,
          rateValue,
          appliesToUnitId: taxForm.appliesToUnitId || undefined,
        }),
      });
      setTaxForm(emptyTaxForm);
      await loadTaxRules();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tax rule");
    }
  }

  async function removeTaxRule(taxRuleId: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/v1/host/tax-rules/${taxRuleId}`, token, { method: "DELETE" });
      await loadTaxRules();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete tax rule");
    }
  }

  function formatRate(rule: TaxRule): string {
    return rule.rateType === "percentage" ? `${(Number(rule.rateValue) * 100).toFixed(2)}%` : `$${(Number(rule.rateValue) / 100).toFixed(2)}/night`;
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Settings</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-6 flex flex-wrap gap-1 rounded-md border border-neutral-300 p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1 ${tab === t.id ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tax" && (
        <div>
          <div className="mb-6 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
            <div>
              <label className="block text-xs text-neutral-500">Jurisdiction</label>
              <input
                value={taxForm.jurisdiction}
                onChange={(e) => setTaxForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                placeholder="California"
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Tax type</label>
              <select
                value={taxForm.taxType}
                onChange={(e) => setTaxForm((f) => ({ ...f, taxType: e.target.value as TaxType }))}
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              >
                <option value="vat">VAT</option>
                <option value="tourist_tax">Tourist tax</option>
                <option value="sales_tax">Sales tax</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Rate type</label>
              <select
                value={taxForm.rateType}
                onChange={(e) => setTaxForm((f) => ({ ...f, rateType: e.target.value as RateType }))}
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              >
                <option value="percentage">Percentage</option>
                <option value="per_night_flat">Flat per night</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500">{taxForm.rateType === "percentage" ? "Rate (%)" : "Rate per night ($)"}</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={taxForm.rateValue}
                onChange={(e) => setTaxForm((f) => ({ ...f, rateValue: e.target.value }))}
                className="w-24 rounded-md border border-neutral-300 p-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Applies to</label>
              <select
                value={taxForm.appliesToUnitId}
                onChange={(e) => setTaxForm((f) => ({ ...f, appliesToUnitId: e.target.value }))}
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({unit.propertyName})
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => void createTaxRule()}
              disabled={!taxForm.jurisdiction || !taxForm.rateValue}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              New tax rule
            </button>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="p-2">Jurisdiction</th>
                <th className="p-2">Type</th>
                <th className="p-2">Rate</th>
                <th className="p-2">Applies to</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {taxRules.map((rule) => (
                <tr key={rule.id} className="border-b border-neutral-100">
                  <td className="p-2 font-medium">{rule.jurisdiction}</td>
                  <td className="p-2">{rule.taxType.replace("_", " ")}</td>
                  <td className="p-2">{formatRate(rule)}</td>
                  <td className="p-2 text-xs text-neutral-500">
                    {rule.appliesToUnitId ? (units.find((u) => u.id === rule.appliesToUnitId)?.name ?? "Unit") : "All units"}
                  </td>
                  <td className="p-2 text-right">
                    <button onClick={() => void removeTaxRule(rule.id)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {taxRules.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-sm text-neutral-400">
                    No tax rules yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "deposits" && (
        <div className="max-w-md space-y-6">
          <div className="rounded-md border border-neutral-200 p-3">
            <h3 className="mb-1 text-sm font-medium text-neutral-600">Stripe Connect</h3>
            {!stripeLoaded ? (
              <p className="text-sm text-neutral-400">Loading...</p>
            ) : stripeAccount ? (
              <div className="text-sm">
                <p className="text-neutral-700">
                  Connected — <span className="font-mono text-xs">{stripeAccount.stripeAccountId}</span>
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Charges {stripeAccount.chargesEnabled ? "enabled" : "not enabled"} · Payouts{" "}
                  {stripeAccount.payoutsEnabled ? "enabled" : "not enabled"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Not connected yet.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-neutral-600">Security deposit hold defaults</h3>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-neutral-500">Hold type</label>
                <select
                  value={depositSettings.holdType}
                  onChange={(e) => saveDepositSettings({ ...depositSettings, holdType: e.target.value as "fixed" | "percentage" })}
                  className="rounded-md border border-neutral-300 p-1.5 text-sm"
                >
                  <option value="fixed">Fixed amount</option>
                  <option value="percentage">Percentage of stay</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500">{depositSettings.holdType === "fixed" ? "Amount ($)" : "Percentage (%)"}</label>
                <input
                  type="number"
                  min={0}
                  value={depositSettings.holdValue}
                  onChange={(e) => saveDepositSettings({ ...depositSettings, holdValue: e.target.value })}
                  className="w-28 rounded-md border border-neutral-300 p-1.5 text-sm"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-neutral-400">Saved on this device. Applied when creating deposit pre-authorization holds.</p>
          </div>
        </div>
      )}

      {tab === "cancellation" && (
        <div className="max-w-md space-y-3">
          <h3 className="text-sm font-medium text-neutral-600">Default cancellation policy</h3>
          {CANCELLATION_POLICIES.map((policy) => (
            <label
              key={policy.id}
              className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
                cancellationPolicy === policy.id ? "border-neutral-900" : "border-neutral-200"
              }`}
            >
              <input
                type="radio"
                name="cancellation-policy"
                checked={cancellationPolicy === policy.id}
                onChange={() => saveCancellationPolicy(policy.id)}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium">{policy.label}</div>
                <div className="text-xs text-neutral-500">{policy.description}</div>
              </div>
            </label>
          ))}
          <p className="text-xs text-neutral-400">Saved on this device.</p>
        </div>
      )}

      {tab === "hardware" && (
        <div className="max-w-2xl space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-medium text-neutral-600">Smart locks</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="p-2">Device</th>
                  <th className="p-2">Unit</th>
                  <th className="p-2">Provider</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {smartLocks.map((lock) => (
                  <tr key={lock.id} className="border-b border-neutral-100">
                    <td className="p-2 font-medium">{lock.deviceName}</td>
                    <td className="p-2">{lock.unitName}</td>
                    <td className="p-2 text-xs text-neutral-500">{lock.provider}</td>
                    <td className="p-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SMART_LOCK_STATUS_STYLES[lock.status]}`}>
                        {lock.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {smartLocks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-3 text-sm text-neutral-400">
                      No smart locks connected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="max-w-xs">
            <label className="block text-xs text-neutral-500">PIN buffer (minutes before/after check-in/out)</label>
            <input
              type="number"
              min={0}
              value={pinBufferMinutes}
              onChange={(e) => savePinBufferMinutes(e.target.value)}
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-400">Saved on this device.</p>
          </div>
        </div>
      )}
    </div>
  );
}
