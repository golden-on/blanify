import { and, eq, gte, lte } from "drizzle-orm";
import { addDays, nightlyAvailability, properties, units, withTenant } from "@repo/db";
import type { ChannelDriver, ExternalBooking } from "../types";

export interface GoogleVacationRentalsOptions {
  feedEndpointUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface GoogleListingFeedEntry {
  propertyId: string;
  title: string;
  address: string | null;
  description: string | null;
}

export interface GoogleAvailabilityEntry {
  date: string;
  available: boolean;
}

export interface GooglePricingEntry {
  date: string;
  priceInCents: number;
}

const DEFAULT_FEED_HORIZON_DAYS = 365;

// Real Google Vacation Rentals integration is feed-push (listing/availability/rate
// feeds uploaded on a schedule), not a live per-call REST API like Airbnb's — so
// syncAvailability/syncRates build the real feed payload from our own DB state (that's
// the actual logic worth having and testing) and push it to a configurable feed
// endpoint, mirroring AirbnbChannelDriver's DB-backed-mock honesty for the parts that
// genuinely can't be verified without real Google credentials.
export class GoogleVacationRentalsDriver implements ChannelDriver {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleVacationRentalsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async formatListingFeed(accountId: string, unitId: string): Promise<GoogleListingFeedEntry> {
    return withTenant(accountId, async (tx) => {
      const [unit] = await tx.select().from(units).where(eq(units.id, unitId));
      if (!unit) {
        throw new Error(`Unit ${unitId} not found`);
      }
      const [property] = await tx.select().from(properties).where(eq(properties.id, unit.propertyId));

      return {
        propertyId: unit.id,
        title: property ? `${property.name} - ${unit.name}` : unit.name,
        address: property?.address ?? null,
        description: unit.checkInInstructions ?? null,
      };
    });
  }

  async formatAvailabilityMatrix(accountId: string, unitId: string, start: string, end: string): Promise<GoogleAvailabilityEntry[]> {
    const nights = await withTenant(accountId, (tx) =>
      tx
        .select()
        .from(nightlyAvailability)
        .where(and(eq(nightlyAvailability.unitId, unitId), gte(nightlyAvailability.date, start), lte(nightlyAvailability.date, end))),
    );

    return nights.map((night) => ({ date: night.date, available: night.status === "available" }));
  }

  async formatPricingFeed(accountId: string, unitId: string, start: string, end: string): Promise<GooglePricingEntry[]> {
    const nights = await withTenant(accountId, (tx) =>
      tx
        .select()
        .from(nightlyAvailability)
        .where(and(eq(nightlyAvailability.unitId, unitId), gte(nightlyAvailability.date, start), lte(nightlyAvailability.date, end))),
    );

    return nights.filter((night) => night.priceInCents !== null).map((night) => ({ date: night.date, priceInCents: night.priceInCents! }));
  }

  private async pushFeed(path: string, payload: unknown): Promise<void> {
    await this.fetchImpl(`${this.options.feedEndpointUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async syncAvailability(accountId: string, unitId: string): Promise<void> {
    const start = new Date().toISOString().slice(0, 10);
    const end = addDays(start, DEFAULT_FEED_HORIZON_DAYS);
    const matrix = await this.formatAvailabilityMatrix(accountId, unitId, start, end);
    await this.pushFeed("/availability", { unitId, matrix });
  }

  async syncRates(accountId: string, unitId: string): Promise<void> {
    const start = new Date().toISOString().slice(0, 10);
    const end = addDays(start, DEFAULT_FEED_HORIZON_DAYS);
    const rates = await this.formatPricingFeed(accountId, unitId, start, end);
    await this.pushFeed("/rates", { unitId, rates });
  }

  async fetchBookings(_accountId: string, _unitId: string): Promise<ExternalBooking[]> {
    // Google Vacation Rentals bookings arrive through the existing generic OTA webhook
    // (Phase 3's /api/webhooks/:channel), not a pull API — there is no per-unit
    // "fetch my bookings" endpoint in Google's feed-based integration model.
    return [];
  }
}
