import { z } from "zod";
import { idSchema } from "./base";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const checkoutSessionRequestSchema = z.object({
  accountId: idSchema,
  unitId: idSchema,
  checkIn: dateStringSchema,
  checkOut: dateStringSchema,
  promoCode: z.string().min(1).optional(),
  selectedAddOnIds: z.array(idSchema).optional().default([]),
});

export const stripeCheckoutMetadataSchema = z.object({
  accountId: idSchema,
  unitId: idSchema,
  checkIn: dateStringSchema,
  checkOut: dateStringSchema,
  // Threaded through so the invoice worker (which only sees the already-
  // processed webhook event, long after the checkout request is gone) has the
  // exact checkout-time figures without recomputing them — nothing else
  // persists which add-ons/promo code a reservation actually used.
  subtotalInCents: z.coerce.number().int().nonnegative(),
  taxInCents: z.coerce.number().int().nonnegative(),
  lineItemsJson: z.string(),
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
