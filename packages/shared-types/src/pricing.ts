import { z } from "zod";
import { idSchema } from "./base";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Mirrors the `pricing_provider` db enum — kept as a standalone schema the same way
// webhooks.ts's channelSchema mirrors channel_type, rather than importing from @repo/db.
export const pricingProviderSchema = z.enum(["pricelabs", "beyond"]);

export const pricingRateUpdateSchema = z.object({
  unitId: idSchema,
  date: dateStringSchema,
  priceInCents: z.number().int().nonnegative(),
});

export const pricingWebhookBodySchema = z.array(pricingRateUpdateSchema).min(1);

export const pricingSyncJobSchema = z.object({
  accountId: idSchema,
  updates: pricingWebhookBodySchema,
});

export type PricingProvider = z.infer<typeof pricingProviderSchema>;
export type PricingRateUpdate = z.infer<typeof pricingRateUpdateSchema>;
export type PricingWebhookBody = z.infer<typeof pricingWebhookBodySchema>;
export type PricingSyncJob = z.infer<typeof pricingSyncJobSchema>;
