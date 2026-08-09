"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

interface Owner {
  id: string;
  name: string;
  email: string;
  commissionPct: string;
}

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface Statement {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossRevenueInCents: number;
  commissionInCents: number;
  netPayoutInCents: number;
  status: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function OwnersPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [owners, setOwners] = useState<Owner[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newOwner, setNewOwner] = useState({ name: "", email: "", commissionPct: "" });
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [split, setSplit] = useState({ unitId: "", splitPct: "" });

  const loadOwners = useCallback(async () => {
    if (!token) return;
    try {
      const [ownersBody, unitsBody] = await Promise.all([
        apiFetch<{ owners: Owner[] }>("/api/v1/host/owners", token),
        apiFetch<{ units: Unit[] }>("/api/v1/host/units", token),
      ]);
      setOwners(ownersBody.owners);
      setUnits(unitsBody.units);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load owners");
    }
  }, [token]);

  useEffect(() => {
    void loadOwners();
  }, [loadOwners]);

  useEffect(() => {
    if (!token || !selectedOwnerId) {
      setStatements([]);
      return;
    }
    apiFetch<{ statements: Statement[] }>(`/api/v1/host/owners/${selectedOwnerId}/statements`, token)
      .then((body) => setStatements(body.statements))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load statements"));
  }, [token, selectedOwnerId]);

  async function createOwner() {
    if (!token || !newOwner.name || !newOwner.email || !newOwner.commissionPct) return;
    try {
      await apiFetch("/api/v1/host/owners", token, {
        method: "POST",
        body: JSON.stringify({
          name: newOwner.name,
          email: newOwner.email,
          commissionPct: Number(newOwner.commissionPct) / 100,
        }),
      });
      setNewOwner({ name: "", email: "", commissionPct: "" });
      await loadOwners();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create owner");
    }
  }

  async function assignSplit() {
    if (!token || !selectedOwnerId || !split.unitId || !split.splitPct) return;
    try {
      await apiFetch(`/api/v1/host/units/${split.unitId}/owners`, token, {
        method: "POST",
        body: JSON.stringify({ ownerId: selectedOwnerId, splitPct: Number(split.splitPct) / 100 }),
      });
      setSplit({ unitId: "", splitPct: "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign unit split");
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Owners</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
        <div>
          <label className="block text-xs text-neutral-500">Name</label>
          <input
            value={newOwner.name}
            onChange={(e) => setNewOwner((o) => ({ ...o, name: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Email</label>
          <input
            value={newOwner.email}
            onChange={(e) => setNewOwner((o) => ({ ...o, email: e.target.value }))}
            className="rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Commission %</label>
          <input
            type="number"
            min={0}
            max={100}
            value={newOwner.commissionPct}
            onChange={(e) => setNewOwner((o) => ({ ...o, commissionPct: e.target.value }))}
            className="w-20 rounded-md border border-neutral-300 p-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => void createOwner()}
          disabled={!newOwner.name || !newOwner.email || !newOwner.commissionPct}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          New owner
        </button>
      </div>

      <div className="grid grid-cols-[1fr_1.5fr] gap-6">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="p-2">Name</th>
              <th className="p-2">Commission</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((owner) => (
              <tr
                key={owner.id}
                onClick={() => setSelectedOwnerId(owner.id)}
                className={`cursor-pointer border-b border-neutral-100 ${selectedOwnerId === owner.id ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
              >
                <td className="p-2">
                  {owner.name}
                  <div className="text-xs text-neutral-400">{owner.email}</div>
                </td>
                <td className="p-2">{(Number(owner.commissionPct) * 100).toFixed(1)}%</td>
              </tr>
            ))}
            {owners.length === 0 && (
              <tr>
                <td colSpan={2} className="p-3 text-sm text-neutral-400">
                  No owners yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {selectedOwnerId && (
          <div>
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
              <div>
                <label className="block text-xs text-neutral-500">Unit</label>
                <select
                  value={split.unitId}
                  onChange={(e) => setSplit((s) => ({ ...s, unitId: e.target.value }))}
                  className="rounded-md border border-neutral-300 p-1.5 text-sm"
                >
                  <option value="">Select a unit</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.propertyName})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500">Split %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={split.splitPct}
                  onChange={(e) => setSplit((s) => ({ ...s, splitPct: e.target.value }))}
                  className="w-20 rounded-md border border-neutral-300 p-1.5 text-sm"
                />
              </div>
              <button
                onClick={() => void assignSplit()}
                disabled={!split.unitId || !split.splitPct}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Assign split
              </button>
            </div>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="p-2">Period</th>
                  <th className="p-2">Gross</th>
                  <th className="p-2">Commission</th>
                  <th className="p-2">Net</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((statement) => (
                  <tr key={statement.id} className="border-b border-neutral-100">
                    <td className="p-2">
                      {statement.periodStart} → {statement.periodEnd}
                    </td>
                    <td className="p-2">{formatCents(statement.grossRevenueInCents)}</td>
                    <td className="p-2">{formatCents(statement.commissionInCents)}</td>
                    <td className="p-2">{formatCents(statement.netPayoutInCents)}</td>
                    <td className="p-2">{statement.status}</td>
                  </tr>
                ))}
                {statements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-sm text-neutral-400">
                      No statements yet — generated monthly on the 1st.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
