"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface SiteConfig {
  id: string;
  slug: string;
  customDomain: string | null;
  primaryColor: string;
  isPublished: boolean;
  heroTitle: string;
  heroSubtitle: string;
  featuredUnitIds: string[];
}

interface FormState {
  slug: string;
  customDomain: string;
  primaryColor: string;
  isPublished: boolean;
  heroTitle: string;
  heroSubtitle: string;
  featuredUnitIds: string[];
}

function toFormState(site: SiteConfig): FormState {
  return {
    slug: site.slug,
    customDomain: site.customDomain ?? "",
    primaryColor: site.primaryColor,
    isPublished: site.isPublished,
    heroTitle: site.heroTitle,
    heroSubtitle: site.heroSubtitle,
    featuredUnitIds: site.featuredUnitIds,
  };
}

export default function WebsitePage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ site: SiteConfig }>("/api/v1/host/site", token);
      setForm(toFormState(body.site));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load site");
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

  function toggleUnit(unitId: string) {
    setForm((f) =>
      f
        ? {
            ...f,
            featuredUnitIds: f.featuredUnitIds.includes(unitId) ? f.featuredUnitIds.filter((id) => id !== unitId) : [...f.featuredUnitIds, unitId],
          }
        : f,
    );
  }

  async function save() {
    if (!token || !form) return;
    setSaveState("saving");
    setError(null);
    try {
      await apiFetch("/api/v1/host/site", token, {
        method: "PATCH",
        body: JSON.stringify({
          slug: form.slug,
          customDomain: form.customDomain || null,
          primaryColor: form.primaryColor,
          heroTitle: form.heroTitle,
          heroSubtitle: form.heroSubtitle,
          featuredUnitIds: form.featuredUnitIds,
          isPublished: form.isPublished,
        }),
      });
      setSaveState("saved");
      await load();
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save site");
      setSaveState("idle");
    }
  }

  if (!form) {
    return (
      <div className="p-6">
        <div className="space-y-2" aria-busy="true" aria-label="Loading website">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-8 w-full max-w-md animate-pulse rounded-md bg-neutral-100" />
          ))}
        </div>
      </div>
    );
  }

  const featuredUnits = units.filter((u) => form.featuredUnitIds.includes(u.id));

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Website</h1>
        <button
          onClick={() => void save()}
          disabled={saveState === "saving"}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save changes"}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-neutral-500">Hero title</label>
            <input
              value={form.heroTitle}
              onChange={(e) => setForm((f) => f && { ...f, heroTitle: e.target.value })}
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Hero subtitle</label>
            <input
              value={form.heroSubtitle}
              onChange={(e) => setForm((f) => f && { ...f, heroSubtitle: e.target.value })}
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Primary theme color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => setForm((f) => f && { ...f, primaryColor: e.target.value })}
                className="h-9 w-14 cursor-pointer rounded-md border border-neutral-300"
              />
              <span className="font-mono text-xs text-neutral-500">{form.primaryColor}</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Featured units</label>
            <div className="space-y-1 rounded-md border border-neutral-200 p-2">
              {units.map((unit) => (
                <label key={unit.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.featuredUnitIds.includes(unit.id)} onChange={() => toggleUnit(unit.id)} />
                  {unit.name} <span className="text-xs text-neutral-400">({unit.propertyName})</span>
                </label>
              ))}
              {units.length === 0 && <p className="text-sm text-neutral-400">No units yet.</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Site slug (subdomain)</label>
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => f && { ...f, slug: e.target.value })}
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Custom domain (optional)</label>
            <input
              value={form.customDomain}
              onChange={(e) => setForm((f) => f && { ...f, customDomain: e.target.value })}
              placeholder="www.example.com"
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) => setForm((f) => f && { ...f, isPublished: e.target.checked })}
            />
            Published
          </label>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-neutral-500">Live preview</div>
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <div className="flex h-40 flex-col items-center justify-center px-4 text-center text-white" style={{ backgroundColor: form.primaryColor }}>
              <div className="text-xl font-semibold">{form.heroTitle || "Your hero title"}</div>
              {form.heroSubtitle && <div className="mt-1 text-sm opacity-90">{form.heroSubtitle}</div>}
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {featuredUnits.length === 0 && <p className="col-span-2 text-sm text-neutral-400">No units featured yet.</p>}
              {featuredUnits.map((unit) => (
                <div key={unit.id} className="rounded-md border border-neutral-200 p-2 text-sm">
                  <div className="font-medium">{unit.name}</div>
                  <div className="text-xs text-neutral-400">{unit.propertyName}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-neutral-100 p-2 text-center text-xs text-neutral-400">
              {form.isPublished ? "Published" : "Not published"} · {form.customDomain || `${form.slug}.platform.com`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
