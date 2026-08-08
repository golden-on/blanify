import { createHmac, timingSafeEqual } from "node:crypto";

// Standard HMAC-SHA256-over-raw-body verification — the near-universal webhook-signing
// pattern (Stripe, GitHub, Shopify). Airbnb's/Booking's actual header name and algorithm
// are undisclosed partner details; adjust to match their real docs once available.
export function signHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyHmacSignature(rawBody: string, signatureHex: string, secret: string): boolean {
  const expected = signHmac(rawBody, secret);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signatureHex, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifyAirbnbSignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.AIRBNB_WEBHOOK_SECRET;
  if (!secret) return false;
  return verifyHmacSignature(rawBody, signatureHeader, secret);
}

export function verifyBookingSignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!secret) return false;
  return verifyHmacSignature(rawBody, signatureHeader, secret);
}

export const SUPPORTED_WEBHOOK_CHANNELS = ["airbnb", "booking"] as const;
export type SupportedWebhookChannel = (typeof SUPPORTED_WEBHOOK_CHANNELS)[number];

export function verifyChannelSignature(
  channel: SupportedWebhookChannel,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;

  switch (channel) {
    case "airbnb":
      return verifyAirbnbSignature(rawBody, signatureHeader);
    case "booking":
      return verifyBookingSignature(rawBody, signatureHeader);
  }
}
