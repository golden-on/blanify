"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

type DiscountType = "percentage" | "fixed_amount";

interface Discount {
  id: string;
  code: string;
  discountType: DiscountType;
  value: string;
  minStayNights: number | null;
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

const emptyForm = {
  code: "",
  discountType: "percentage" as DiscountType,
  value: "",
  minStayNights: "",
  validFrom: "",
  validTo: "",
};

export default function DiscountsPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const loadDiscounts = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ discounts: Discount[] }>("/api/v1/host/discounts", token);
      setDiscounts(body.discounts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load discounts");
    }
  }, [token]);

  useEffect(() => {
    void loadDiscounts();
  }, [loadDiscounts]);

  async function createDiscount() {
    if (!token || !form.code || !form.value || !form.validFrom || !form.validTo) return;
    try {
      await apiFetch("/api/v1/host/discounts", token, {
        method: "POST",
        body: JSON.stringify({
          code: form.code,
          discountType: form.discountType,
          value: form.discountType === "percentage" ? Number(form.value) / 100 : Math.round(Number(form.value) * 100),
          minStayNights: form.minStayNights ? Number(form.minStayNights) : undefined,
          validFrom: new Date(form.validFrom).toISOString(),
          validTo: new Date(form.validTo).toISOString(),
        }),
      });
      setForm(emptyForm);
      await loadDiscounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create discount");
    }
  }

  async function removeDiscount(discountId: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/v1/host/discounts/${discountId}`, token, { method: "DELETE" });
      await loadDiscounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete discount");
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Discounts</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
        <div>
          <label className="block text-xs text-neutral-500">Code</label>
          <input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="SUMMER25"
            className="w-32 rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Type</label>
          <select
            value={form.discountType}
            onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as DiscountType }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          >
            <option value="percentage">Percentage</option>
            <option value="fixed_amount">Fixed amount</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">{form.discountType === "percentage" ? "Value (%)" : "Value ($)"}</label>
          <input
            type="number"
            min={0}
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            className="w-24 rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Min stay (nights)</label>
          <input
            type="number"
            min={1}
            value={form.minStayNights}
            onChange={(e) => setForm((f) => ({ ...f, minStayNights: e.target.value }))}
            className="w-24 rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Valid from</label>
          <input
            type="date"
            value={form.validFrom}
            onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Valid to</label>
          <input
            type="date"
            value={form.validTo}
            onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => void createDiscount()}
          disabled={!form.code || !form.value || !form.validFrom || !form.validTo}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          New discount
        </button>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="p-2">Code</th>
            <th className="p-2">Type</th>
            <th className="p-2">Value</th>
            <th className="p-2">Min stay</th>
            <th className="p-2">Window</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {discounts.map((discount) => (
            <tr key={discount.id} className="border-b border-neutral-100">
              <td className="p-2 font-medium">{discount.code}</td>
              <td className="p-2">{discount.discountType}</td>
              <td className="p-2">
                {discount.discountType === "percentage" ? `${(Number(discount.value) * 100).toFixed(0)}%` : `$${(Number(discount.value) / 100).toFixed(2)}`}
              </td>
              <td className="p-2">{discount.minStayNights ?? "—"}</td>
              <td className="p-2 text-xs text-neutral-500">
                {new Date(discount.validFrom).toLocaleDateString()} – {new Date(discount.validTo).toLocaleDateString()}
              </td>
              <td className="p-2 text-right">
                <button onClick={() => void removeDiscount(discount.id)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {discounts.length === 0 && (
            <tr>
              <td colSpan={6} className="p-3 text-sm text-neutral-400">
                No discounts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
