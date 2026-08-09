import { z } from "zod";
import { idSchema } from "./base";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const checkoutSessionRequestSchema = z.object({
  accountId: idSchema,
  unitId: idSchema,
  checkIn: dateStringSchema,
  checkOut: dateStringSchema,
});

export const stripeCheckoutMetadataSchema = z.object({
  accountId: idSchema,
  unitId: idSchema,
  checkIn: dateStringSchema,
  checkOut: dateStringSchema,
});

export const stripeCheckoutSessionObjectSchema = z.object({
  payment_intent: z.string(),
  metadata: stripeCheckoutMetadataSchema,
});

export const stripeWebhookJobSchema = z.object({
  webhookEventId: idSchema,
});

export type CheckoutSessionRequest = z.infer<typeof checkoutSessionRequestSchema>;
export type StripeCheckoutMetadata = z.infer<typeof stripeCheckoutMetadataSchema>;
export type StripeWebhookJob = z.infer<typeof stripeWebhookJobSchema>;
