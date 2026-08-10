import { z } from "zod";

export const createDiscountRequestSchema = z.object({
  code: z.string().min(1),
  discountType: z.enum(["percentage", "fixed_amount"]),
  value: z.number().positive(),
  minStayNights: z.number().int().positive().optional(),
  validFrom: z.string().min(1),
  validTo: z.string().min(1),
});

export type CreateDiscountRequest = z.infer<typeof createDiscountRequestSchema>;
