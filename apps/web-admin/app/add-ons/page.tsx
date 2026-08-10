"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

type FeeType = "per_stay" | "per_night";

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface AddOn {
  id: string;
  unitId: string;
  name: string;
  description: string | null;
  priceInCents: number;
  feeType: FeeType;
  isRequired: boolean;
}

const emptyForm = { name: "", description: "", price: "", feeType: "per_stay" as FeeType, isRequired: false };

export default function AddOnsPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ units: Unit[] }>("/api/v1/host/units", token)
      .then((body) => {
        setUnits(body.units);
        setSelectedUnitId((current) => current || body.units[0]?.id || "");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load units"));
  }, [token]);

  const loadAddOns = useCallback(async () => {
    if (!token || !selectedUnitId) return;
    try {
      const body = await apiFetch<{ addOns: AddOn[] }>(`/api/v1/host/add-ons?unitId=${selectedUnitId}`, token);
      setAddOns(body.addOns);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load add-ons");
    }
  }, [token, selectedUnitId]);

  useEffect(() => {
    void loadAddOns();
  }, [loadAddOns]);

  async function createAddOn() {
    if (!token || !selectedUnitId || !form.name || !form.price) return;
    try {
      await apiFetch("/api/v1/host/add-ons", token, {
        method: "POST",
        body: JSON.stringify({
          unitId: selectedUnitId,
          name: form.name,
          description: form.description || undefined,
          priceInCents: Math.round(Number(form.price) * 100),
          feeType: form.feeType,
          isRequired: form.isRequired,
        }),
      });
      setForm(emptyForm);
      await loadAddOns();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create add-on");
    }
  }

  async function removeAddOn(addOnId: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/v1/host/add-ons/${addOnId}`, token, { method: "DELETE" });
      await loadAddOns();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete add-on");
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Add-Ons</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4">
        <label className="block text-xs text-neutral-500">Unit</label>
        <select
          value={selectedUnitId}
          onChange={(e) => setSelectedUnitId(e.target.value)}
          className="rounded-md border border-neutral-300 p-1.5 text-sm"
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name} ({unit.propertyName})
            </option>
          ))}
        </select>
      </div>

      {selectedUnitId && (
        <>
          <div className="mb-6 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
            <div>
              <label className="block text-xs text-neutral-500">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Cleaning fee"
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Price ($)</label>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="w-24 rounded-md border border-neutral-300 p-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Fee type</label>
              <select
                value={form.feeType}
                onChange={(e) => setForm((f) => ({ ...f, feeType: e.target.value as FeeType }))}
                className="rounded-md border border-neutral-300 p-1.5 text-sm"
              >
                <option value="per_stay">Per stay</option>
                <option value="per_night">Per night</option>
              </select>
            </div>
            <label className="flex items-center gap-1 text-xs text-neutral-500">
              <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))} />
              Required
            </label>
            <button
              onClick={() => void createAddOn()}
              disabled={!form.name || !form.price}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              New add-on
            </button>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="p-2">Name</th>
                <th className="p-2">Price</th>
                <th className="p-2">Fee type</th>
                <th className="p-2">Required</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {addOns.map((addOn) => (
                <tr key={addOn.id} className="border-b border-neutral-100">
                  <td className="p-2">
                    {addOn.name}
                    {addOn.description && <div className="text-xs text-neutral-400">{addOn.description}</div>}
                  </td>
                  <td className="p-2">${(addOn.priceInCents / 100).toFixed(2)}</td>
                  <td className="p-2">{addOn.feeType}</td>
                  <td className="p-2">{addOn.isRequired ? "Yes" : "No"}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => void removeAddOn(addOn.id)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {addOns.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-sm text-neutral-400">
                    No add-ons yet for this unit.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
