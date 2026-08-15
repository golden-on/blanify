"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Star, Trash2 } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

interface Bed {
  type: string;
  count: number;
}

interface RoomConfig {
  guests: number;
  bedrooms: number;
  bathrooms: number;
  beds: Bed[];
}

interface UnitPhoto {
  url: string;
  caption?: string;
}

interface UnitPolicies {
  description?: string;
  cleaningFeeInCents?: number;
  baseRateInCents?: number;
  checkInTime?: string;
  checkOutTime?: string;
}

interface Unit {
  id: string;
  name: string;
  propertyName: string;
  propertyAddress: string | null;
  checkInInstructions: string | null;
  roomsConfig: RoomConfig | null;
  amenities: string[] | null;
  photos: UnitPhoto[] | null;
  policies: UnitPolicies | null;
}

interface FormState {
  name: string;
  checkInInstructions: string;
  roomsConfig: RoomConfig;
  amenities: string[];
  photos: UnitPhoto[];
  policies: UnitPolicies;
}

type Tab = "overview" | "rooms" | "amenities" | "photos" | "policies";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "rooms", label: "Rooms & Capacity" },
  { id: "amenities", label: "Amenities" },
  { id: "photos", label: "Photos" },
  { id: "policies", label: "Policies & Rates" },
];

const AMENITIES_CATALOG: Record<string, { key: string; label: string }[]> = {
  Essentials: [
    { key: "wifi", label: "Wifi" },
    { key: "kitchen", label: "Kitchen" },
    { key: "washer", label: "Washer" },
    { key: "air_conditioning", label: "Air conditioning" },
    { key: "heating", label: "Heating" },
    { key: "workspace", label: "Dedicated workspace" },
  ],
  Features: [
    { key: "pool", label: "Pool" },
    { key: "hot_tub", label: "Hot tub" },
    { key: "free_parking", label: "Free parking" },
    { key: "ev_charger", label: "EV charger" },
    { key: "bbq_grill", label: "BBQ grill" },
    { key: "fire_pit", label: "Fire pit" },
  ],
  Safety: [
    { key: "smoke_alarm", label: "Smoke alarm" },
    { key: "co_alarm", label: "Carbon monoxide alarm" },
    { key: "fire_extinguisher", label: "Fire extinguisher" },
    { key: "first_aid_kit", label: "First aid kit" },
  ],
  Location: [
    { key: "beachfront", label: "Beachfront" },
    { key: "waterfront", label: "Waterfront" },
    { key: "ski_in_ski_out", label: "Ski-in/ski-out" },
    { key: "mountain_view", label: "Mountain view" },
    { key: "city_center", label: "City center" },
  ],
};

const emptyForm: FormState = {
  name: "",
  checkInInstructions: "",
  roomsConfig: { guests: 1, bedrooms: 0, bathrooms: 0, beds: [] },
  amenities: [],
  photos: [],
  policies: {},
};

function centsToInput(cents: number | undefined): string {
  return cents === undefined ? "" : (cents / 100).toFixed(2);
}

function inputToCents(value: string): number | undefined {
  return value === "" ? undefined : Math.round(Number(value) * 100);
}

export default function UnitWorkspacePage() {
  const params = useParams<{ id: string }>();
  const unitId = params.id;
  const { session } = useSession();
  const token = session?.token ?? null;

  const [unit, setUnit] = useState<Unit | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ units: Unit[] }>("/api/v1/host/units", token);
      const found = body.units.find((u) => u.id === unitId) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setUnit(found);
      setForm({
        name: found.name,
        checkInInstructions: found.checkInInstructions ?? "",
        roomsConfig: found.roomsConfig ?? emptyForm.roomsConfig,
        amenities: found.amenities ?? [],
        photos: found.photos ?? [],
        policies: found.policies ?? {},
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load unit");
    }
  }, [token, unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!token) return;
    setSaveState("saving");
    setError(null);
    try {
      await apiFetch(`/api/v1/host/units/${unitId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          checkInInstructions: form.checkInInstructions || undefined,
          roomsConfig: form.roomsConfig,
          amenities: form.amenities,
          photos: form.photos,
          policies: form.policies,
        }),
      });
      setSaveState("saved");
      await load();
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save unit");
      setSaveState("idle");
    }
  }

  function toggleAmenity(key: string) {
    setForm((f) => ({
      ...f,
      amenities: f.amenities.includes(key) ? f.amenities.filter((a) => a !== key) : [...f.amenities, key],
    }));
  }

  function addBed() {
    setForm((f) => ({ ...f, roomsConfig: { ...f.roomsConfig, beds: [...f.roomsConfig.beds, { type: "queen", count: 1 }] } }));
  }

  function updateBed(index: number, patch: Partial<Bed>) {
    setForm((f) => ({
      ...f,
      roomsConfig: { ...f.roomsConfig, beds: f.roomsConfig.beds.map((b, i) => (i === index ? { ...b, ...patch } : b)) },
    }));
  }

  function removeBed(index: number) {
    setForm((f) => ({ ...f, roomsConfig: { ...f.roomsConfig, beds: f.roomsConfig.beds.filter((_, i) => i !== index) } }));
  }

  function addPhoto() {
    setForm((f) => ({ ...f, photos: [...f.photos, { url: "", caption: "" }] }));
  }

  function updatePhoto(index: number, patch: Partial<UnitPhoto>) {
    setForm((f) => ({ ...f, photos: f.photos.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));
  }

  function removePhoto(index: number) {
    setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== index) }));
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setForm((f) => {
      const target = index + direction;
      if (target < 0 || target >= f.photos.length) return f;
      const photos = [...f.photos];
      [photos[index], photos[target]] = [photos[target]!, photos[index]!];
      return { ...f, photos };
    });
  }

  function setHero(index: number) {
    setForm((f) => {
      if (index === 0) return f;
      const photos = [...f.photos];
      const [photo] = photos.splice(index, 1);
      photos.unshift(photo!);
      return { ...f, photos };
    });
  }

  if (notFound) {
    return (
      <div className="p-6">
        <Link href="/calendar" className="mb-4 flex items-center gap-1 text-sm text-neutral-500 hover:underline">
          <ArrowLeft size={14} /> Back to calendar
        </Link>
        <p className="text-sm text-neutral-500">Unit not found.</p>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="p-6">
        <div className="space-y-2" aria-busy="true" aria-label="Loading unit">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-8 w-full max-w-md animate-pulse rounded-md bg-neutral-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Link href="/calendar" className="mb-2 flex items-center gap-1 text-sm text-neutral-500 hover:underline">
        <ArrowLeft size={14} /> Back to calendar
      </Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{unit.name}</h1>
        <button
          onClick={() => void save()}
          disabled={saveState === "saving"}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save changes"}
        </button>
      </div>

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

      {tab === "overview" && (
        <div className="max-w-md space-y-3">
          <div>
            <label className="block text-xs text-neutral-500">Title</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Property address</label>
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm text-neutral-600">
              {unit.propertyName}
              {unit.propertyAddress ? ` — ${unit.propertyAddress}` : ""}
            </p>
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Internal description</label>
            <textarea
              value={form.policies.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, policies: { ...f.policies, description: e.target.value } }))}
              rows={4}
              className="w-full resize-none rounded-md border border-neutral-300 p-2 text-sm"
              placeholder="Notes for staff, not shown to guests"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Check-in instructions</label>
            <textarea
              value={form.checkInInstructions}
              onChange={(e) => setForm((f) => ({ ...f, checkInInstructions: e.target.value }))}
              rows={3}
              className="w-full resize-none rounded-md border border-neutral-300 p-2 text-sm"
            />
          </div>
        </div>
      )}

      {tab === "rooms" && (
        <div className="max-w-md space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-neutral-500">Guests</label>
              <input
                type="number"
                min={1}
                value={form.roomsConfig.guests}
                onChange={(e) => setForm((f) => ({ ...f, roomsConfig: { ...f.roomsConfig, guests: Number(e.target.value) } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Bedrooms</label>
              <input
                type="number"
                min={0}
                value={form.roomsConfig.bedrooms}
                onChange={(e) => setForm((f) => ({ ...f, roomsConfig: { ...f.roomsConfig, bedrooms: Number(e.target.value) } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Bathrooms</label>
              <input
                type="number"
                min={0}
                value={form.roomsConfig.bathrooms}
                onChange={(e) => setForm((f) => ({ ...f, roomsConfig: { ...f.roomsConfig, bathrooms: Number(e.target.value) } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-neutral-500">Bed breakdown</label>
              <button onClick={addBed} className="flex items-center gap-1 text-xs text-neutral-600 hover:underline">
                <Plus size={12} /> Add bed type
              </button>
            </div>
            <div className="space-y-2">
              {form.roomsConfig.beds.map((bed, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={bed.type}
                    onChange={(e) => updateBed(i, { type: e.target.value })}
                    placeholder="Queen"
                    className="flex-1 rounded-md border border-neutral-300 p-1.5 text-sm"
                  />
                  <input
                    type="number"
                    min={1}
                    value={bed.count}
                    onChange={(e) => updateBed(i, { count: Number(e.target.value) })}
                    className="w-16 rounded-md border border-neutral-300 p-1.5 text-sm"
                  />
                  <button onClick={() => removeBed(i)} className="text-red-600 hover:text-red-800">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {form.roomsConfig.beds.length === 0 && <p className="text-sm text-neutral-400">No beds added yet.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "amenities" && (
        <div className="max-w-2xl space-y-5">
          {Object.entries(AMENITIES_CATALOG).map(([category, items]) => (
            <div key={category}>
              <h3 className="mb-2 text-sm font-medium text-neutral-600">{category}</h3>
              <div className="flex flex-wrap gap-2">
                {items.map((item) => {
                  const active = form.amenities.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      onClick={() => toggleAmenity(item.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "photos" && (
        <div className="max-w-xl space-y-3">
          <button onClick={addPhoto} className="flex items-center gap-1 text-sm text-neutral-600 hover:underline">
            <Plus size={14} /> Add photo
          </button>
          {form.photos.map((photo, i) => (
            <div key={i} className="rounded-md border border-neutral-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-500">
                  Photo {i + 1} {i === 0 && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Hero</span>}
                </span>
                <div className="flex items-center gap-2">
                  {i !== 0 && (
                    <button onClick={() => setHero(i)} title="Set as hero" className="text-neutral-500 hover:text-neutral-800">
                      <Star size={14} />
                    </button>
                  )}
                  <button onClick={() => movePhoto(i, -1)} disabled={i === 0} className="text-neutral-500 hover:text-neutral-800 disabled:opacity-30">
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => movePhoto(i, 1)}
                    disabled={i === form.photos.length - 1}
                    className="text-neutral-500 hover:text-neutral-800 disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button onClick={() => removePhoto(i)} className="text-red-600 hover:text-red-800">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <input
                value={photo.url}
                onChange={(e) => updatePhoto(i, { url: e.target.value })}
                placeholder="https://..."
                className="mb-2 w-full rounded-md border border-neutral-300 p-1.5 text-sm"
              />
              <input
                value={photo.caption ?? ""}
                onChange={(e) => updatePhoto(i, { caption: e.target.value })}
                placeholder="Caption (optional)"
                className="w-full rounded-md border border-neutral-300 p-1.5 text-sm"
              />
            </div>
          ))}
          {form.photos.length === 0 && <p className="text-sm text-neutral-400">No photos added yet.</p>}
        </div>
      )}

      {tab === "policies" && (
        <div className="max-w-md space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-neutral-500">Default cleaning fee ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={centsToInput(form.policies.cleaningFeeInCents)}
                onChange={(e) => setForm((f) => ({ ...f, policies: { ...f.policies, cleaningFeeInCents: inputToCents(e.target.value) } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Base nightly rate ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={centsToInput(form.policies.baseRateInCents)}
                onChange={(e) => setForm((f) => ({ ...f, policies: { ...f.policies, baseRateInCents: inputToCents(e.target.value) } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-neutral-500">Check-in time</label>
              <input
                type="time"
                value={form.policies.checkInTime ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, policies: { ...f.policies, checkInTime: e.target.value || undefined } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">Check-out time</label>
              <input
                type="time"
                value={form.policies.checkOutTime ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, policies: { ...f.policies, checkOutTime: e.target.value || undefined } }))}
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
