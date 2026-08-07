export interface ChannelDriver {
  syncAvailability(unitId: string): Promise<void>;
  syncRates(unitId: string): Promise<void>;
  fetchBookings(unitId: string): Promise<unknown[]>;
}
