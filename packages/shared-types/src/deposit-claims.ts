import { z } from "zod";

export const claimDepositRequestSchema = z.object({
  amountInCents: z.number().int().positive(),
  reason: z.string().min(1),
  evidenceUrls: z.array(z.string().url()).optional().default([]),
});

export type ClaimDepositRequest = z.infer<typeof claimDepositRequestSchema>;
