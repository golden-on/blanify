import { z } from "zod";
import { idSchema } from "./base";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const blockDatesRequestSchema = z.object({
  dates: z.array(dateStringSchema).min(1),
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

export type BlockDatesRequest = z.infer<typeof blockDatesRequestSchema>;
export type CreatePropertyRequest = z.infer<typeof createPropertyRequestSchema>;
export type CreateUnitRequest = z.infer<typeof createUnitRequestSchema>;
