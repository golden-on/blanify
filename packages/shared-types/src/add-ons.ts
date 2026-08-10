import { z } from "zod";
import { idSchema } from "./base";

export const createAddOnRequestSchema = z.object({
  unitId: idSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  priceInCents: z.number().int().positive(),
  feeType: z.enum(["per_stay", "per_night"]),
  isRequired: z.boolean().optional(),
});

export type CreateAddOnRequest = z.infer<typeof createAddOnRequestSchema>;
