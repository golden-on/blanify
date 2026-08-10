import { z } from "zod";

export const guestCheckInRequestSchema = z.object({
  fullName: z.string().min(1),
  signatureDataUrl: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/, "signatureDataUrl must be a base64 image data URI"),
});

export type GuestCheckInRequest = z.infer<typeof guestCheckInRequestSchema>;
