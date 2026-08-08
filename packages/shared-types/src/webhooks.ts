import { z } from "zod";
import { idSchema } from "./base";

export const channelSchema = z.enum(["airbnb", "booking", "vrbo"]);

export const webhookEventTypeSchema = z.enum(["reservation.created", "reservation.cancelled"]);

// Our own normalized contract for inbound OTA webhooks, not Airbnb's/Booking's real
// (undisclosed, partner-gated) payload shape — see Phase 3 Level 2 plan.
export const webhookPayloadSchema = z.object({
  eventId: z.string(),
  eventType: webhookEventTypeSchema,
  externalPropertyId: z.string(),
  externalRoomId: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
});

export const otaWebhookJobSchema = z.object({
  webhookEventId: idSchema,
});

export type Channel = z.infer<typeof channelSchema>;
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type OtaWebhookJob = z.infer<typeof otaWebhookJobSchema>;
