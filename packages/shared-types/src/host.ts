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

export type BlockDatesRequest = z.infer<typeof blockDatesRequestSchema>;
export type CreatePropertyRequest = z.infer<typeof createPropertyRequestSchema>;
export type CreateUnitRequest = z.infer<typeof createUnitRequestSchema>;
export type ReservationChannel = z.infer<typeof reservationChannelSchema>;
export type CreateReservationRequest = z.infer<typeof createReservationRequestSchema>;
