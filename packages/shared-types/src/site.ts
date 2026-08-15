import { z } from "zod";
import { idSchema } from "./base";

export const updateSiteRequestSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, and hyphens only")
    .optional(),
  customDomain: z.string().min(1).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color, e.g. #0f172a")
    .optional(),
  heroTitle: z.string().min(1).optional(),
  heroSubtitle: z.string().optional(),
  featuredUnitIds: z.array(idSchema).optional(),
  isPublished: z.boolean().optional(),
});

export type UpdateSiteRequest = z.infer<typeof updateSiteRequestSchema>;
