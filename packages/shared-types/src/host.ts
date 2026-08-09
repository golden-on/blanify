import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const blockDatesRequestSchema = z.object({
  dates: z.array(dateStringSchema).min(1),
});

export type BlockDatesRequest = z.infer<typeof blockDatesRequestSchema>;
