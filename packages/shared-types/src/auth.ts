import { z } from "zod";
import { idSchema } from "./base";

export const registerRequestSchema = z.object({
  accountName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Validates the *decoded* JWT payload shape rather than just trusting it — jwt.verify
// only proves the signature is valid, not that the claims match what we expect.
export const authTokenPayloadSchema = z.object({
  sub: idSchema,
  accountId: idSchema,
  email: z.string().email(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthTokenPayload = z.infer<typeof authTokenPayloadSchema>;
