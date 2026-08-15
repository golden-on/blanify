import { z } from "zod";
import { idSchema } from "./base";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const blockDatesRequestSchema = z.object({
  dates: z.array(dateStringSchema).min(1),
  reason: z.string().min(1).optional(),
});

export const createPropertyRequestSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1).optional(),
});

export const createUnitRequestSchema = z.object({
  propertyId: idSchema,
  name: z.string().min(1),
  checkInInstructions: z.string().min(1).optional(),
});

export const reservationChannelSchema = z.enum(["airbnb", "booking_com", "direct", "ical"]);

export const createReservationRequestSchema = z.object({
  unitId: idSchema,
  checkIn: dateStringSchema,
  checkOut: dateStringSchema,
  guestName: z.string().min(1),
  guestEmail: z.string().email().optional(),
  channel: reservationChannelSchema.optional().default("direct"),
  totalPriceInCents: z.number().int().positive().optional(),
});

// Free-text on the wire (see packages/db/src/schema/reservations.ts — `status`
// stays a plain text column, not a pgEnum). "checked_in"/"checked_out" are listed
// as valid filter values even though nothing in the codebase sets them yet — no
// check-in/check-out automation exists today; only "confirmed" and "cancelled"
// will ever actually match a row until a future phase adds that automation.
export const reservationStatusFilterSchema = z.enum(["confirmed", "cancelled", "checked_in", "checked_out"]);

export const listReservationsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: reservationStatusFilterSchema.optional(),
  unitId: idSchema.optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const cancelReservationSchema = z.object({
  refund: z.boolean().optional().default(false),
});

export type BlockDatesRequest = z.infer<typeof blockDatesRequestSchema>;
export type CreatePropertyRequest = z.infer<typeof createPropertyRequestSchema>;
export type CreateUnitRequest = z.infer<typeof createUnitRequestSchema>;
export type ReservationChannel = z.infer<typeof reservationChannelSchema>;
export type CreateReservationRequest = z.infer<typeof createReservationRequestSchema>;
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;
export type CancelReservationRequest = z.infer<typeof cancelReservationSchema>;
