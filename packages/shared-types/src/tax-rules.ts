import { z } from "zod";
import { idSchema } from "./base";

export const createTaxRuleRequestSchema = z.object({
  jurisdiction: z.string().min(1),
  taxType: z.enum(["vat", "tourist_tax", "sales_tax"]),
  rateType: z.enum(["percentage", "per_night_flat"]),
  rateValue: z.number().positive(),
  appliesToUnitId: idSchema.optional(),
});

export type CreateTaxRuleRequest = z.infer<typeof createTaxRuleRequestSchema>;
