import { eq } from "drizzle-orm";
import { withTenant, nightlyAvailability } from "@repo/db";
import type { ChannelDriver, ExternalBooking } from "../types";
import type { ChannelDriverConnection } from "./airbnb";

// Mock driver: Booking.com's Connectivity API is partner-gated, so this reads our own DB
// state (what a real push would send) and marks where the actual HTTP call belongs.
export class BookingChannelDriver implements ChannelDriver {
  constructor(private readonly connection: ChannelDriverConnection) {}

  async syncAvailability(accountId: string, unitId: string): Promise<void> {
    const nights = await withTenant(accountId, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unitId)),
    );
    // Real implementation: push `nights` to Booking.com's availability API using
    // this.connection.accessToken.
    void nights;
    void this.connection;
  }

  async syncRates(accountId: string, unitId: string): Promise<void> {
    const nights = await withTenant(accountId, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unitId)),
    );
    // Real implementation: push `nights[].priceInCents` to Booking.com's pricing API.
    void nights;
  }

  async fetchBookings(_accountId: string, _unitId: string): Promise<ExternalBooking[]> {
    // Real implementation: call Booking.com's reservations API. Bookings arrive via
    // webhook in this platform, so this is a fallback/reconciliation path.
    return [];
  }
}
