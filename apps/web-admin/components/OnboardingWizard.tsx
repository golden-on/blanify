"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

interface OnboardingWizardProps {
  token: string;
  onComplete: () => void;
}

export function OnboardingWizard({ token, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [property, setProperty] = useState({ name: "", address: "" });
  const [unit, setUnit] = useState({ name: "", checkInInstructions: "" });

  async function submitProperty() {
    if (!property.name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ property: { id: string } }>("/api/v1/host/properties", token, {
        method: "POST",
        body: JSON.stringify({ name: property.name, address: property.address || undefined }),
      });
      setPropertyId(body.property.id);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create property");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitUnit() {
    if (!propertyId || !unit.name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/v1/host/units", token, {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          name: unit.name,
          checkInInstructions: unit.checkInInstructions || undefined,
        }),
      });
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create unit");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-md rounded-lg border border-neutral-200 p-6">
      <h2 className="mb-1 text-base font-semibold">Welcome to Blanify</h2>
      <p className="mb-6 text-sm text-neutral-500">
        {step === 1 ? "Let's start with your first property." : "Now add its first bookable unit."}
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {step === 1 ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-500">Property name</label>
            <input
              value={property.name}
              onChange={(e) => setProperty((p) => ({ ...p, name: e.target.value }))}
              placeholder="Sunset Villas"
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Address (optional)</label>
            <input
              value={property.address}
              onChange={(e) => setProperty((p) => ({ ...p, address: e.target.value }))}
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <button
            onClick={() => void submitProperty()}
            disabled={!property.name.trim() || isSubmitting}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Next: add a unit"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-500">Unit name</label>
            <input
              value={unit.name}
              onChange={(e) => setUnit((u) => ({ ...u, name: e.target.value }))}
              placeholder="Unit 1"
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Check-in instructions (optional)</label>
            <textarea
              value={unit.checkInInstructions}
              onChange={(e) => setUnit((u) => ({ ...u, checkInInstructions: e.target.value }))}
              rows={3}
              className="w-full resize-none rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <button
            onClick={() => void submitUnit()}
            disabled={!unit.name.trim() || isSubmitting}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Finish"}
          </button>
        </div>
      )}
    </div>
  );
}
