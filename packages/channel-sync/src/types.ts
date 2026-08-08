export interface ExternalBooking {
  externalReservationId: string;
  checkIn: string;
  checkOut: string;
}

export interface ChannelDriver {
  syncAvailability(accountId: string, unitId: string): Promise<void>;
  syncRates(accountId: string, unitId: string): Promise<void>;
  fetchBookings(accountId: string, unitId: string): Promise<ExternalBooking[]>;
}
