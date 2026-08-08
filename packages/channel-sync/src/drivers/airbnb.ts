import { eq } from "drizzle-orm";
import { withTenant, nightlyAvailability } from "@repo/db";
import type { ChannelDriver, ExternalBooking } from "../types";

export interface ChannelDriverConnection {
  accessToken: string;
}

// Mock driver: Airbnb's Partner API is credential-gated, so this reads our own DB state
// (exactly what a real push integration would need to send) and marks where the actual
// HTTP call to Airbnb's API would go, rather than guessing at unverified endpoint shapes.
export class AirbnbChannelDriver implements ChannelDriver {
  constructor(private readonly connection: ChannelDriverConnection) {}

  async syncAvailability(accountId: string, unitId: string): Promise<void> {
    const nights = await withTenant(accountId, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unitId)),
    );
    // Real implementation: POST `nights` to Airbnb's calendar/availability API using
    // this.connection.accessToken.
    void nights;
    void this.connection;
  }

  async syncRates(accountId: string, unitId: string): Promise<void> {
    const nights = await withTenant(accountId, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unitId)),
    );
    // Real implementation: POST `nights[].priceInCents` to Airbnb's pricing API.
    void nights;
  }

  async fetchBookings(_accountId: string, _unitId: string): Promise<ExternalBooking[]> {
    // Real implementation: call Airbnb's reservations API and map results to
    // ExternalBooking[]. Bookings arrive via webhook in this platform, so this is a
    // fallback/reconciliation path, not the primary ingestion mechanism.
    return [];
  }
}
