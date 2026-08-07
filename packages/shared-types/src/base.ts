import { z } from "zod";

export const idSchema = z.string().uuid();

export const timestampsSchema = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type Timestamps = z.infer<typeof timestampsSchema>;
