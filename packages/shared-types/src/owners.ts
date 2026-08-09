import { z } from "zod";
import { idSchema } from "./base";

export const createOwnerRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  commissionPct: z.number().min(0).max(1),
  stripeConnectedAccountId: z.string().min(1).optional(),
});

export const createUnitOwnerRequestSchema = z.object({
  ownerId: idSchema,
  splitPct: z.number().min(0).max(1),
});

export type CreateOwnerRequest = z.infer<typeof createOwnerRequestSchema>;
export type CreateUnitOwnerRequest = z.infer<typeof createUnitOwnerRequestSchema>;
