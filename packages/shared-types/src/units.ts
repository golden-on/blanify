import { z } from "zod";

const timeOfDaySchema = z.string().regex(/^\d{2}:\d{2}$/);

export const roomConfigSchema = z.object({
  guests: z.number().int().min(1),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  beds: z.array(z.object({ type: z.string().min(1), count: z.number().int().min(1) })).default([]),
});

export const unitPhotoSchema = z.object({
  url: z.string().url(),
  caption: z.string().optional(),
});

export const unitPoliciesSchema = z.object({
  description: z.string().optional(),
  cleaningFeeInCents: z.number().int().min(0).optional(),
  baseRateInCents: z.number().int().min(0).optional(),
  checkInTime: timeOfDaySchema.optional(),
  checkOutTime: timeOfDaySchema.optional(),
});

export const updateUnitRequestSchema = z.object({
  name: z.string().min(1).optional(),
  checkInInstructions: z.string().optional(),
  roomsConfig: roomConfigSchema.optional(),
  amenities: z.array(z.string()).optional(),
  photos: z.array(unitPhotoSchema).optional(),
  policies: unitPoliciesSchema.optional(),
});

export type RoomConfig = z.infer<typeof roomConfigSchema>;
export type UnitPhoto = z.infer<typeof unitPhotoSchema>;
export type UnitPolicies = z.infer<typeof unitPoliciesSchema>;
export type UpdateUnitRequest = z.infer<typeof updateUnitRequestSchema>;
