import { z } from "zod";
import { idSchema } from "./base";

export const heroSectionSchema = z.object({
  type: z.literal("hero"),
  title: z.string(),
  subtitle: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export const gallerySectionSchema = z.object({
  type: z.literal("gallery"),
  images: z.array(z.string().url()),
});

export const roomCardsSectionSchema = z.object({
  type: z.literal("room_cards"),
  unitIds: z.array(idSchema),
});

export const amenitiesSectionSchema = z.object({
  type: z.literal("amenities"),
  items: z.array(z.string()),
});

export const faqSectionSchema = z.object({
  type: z.literal("faq"),
  items: z.array(z.object({ question: z.string(), answer: z.string() })),
});

export const sectionSchema = z.discriminatedUnion("type", [
  heroSectionSchema,
  gallerySectionSchema,
  roomCardsSectionSchema,
  amenitiesSectionSchema,
  faqSectionSchema,
]);

export const layoutSchemaSchema = z.array(sectionSchema);

export const themeConfigSchema = z.object({
  primaryColor: z.string(),
  fontFamily: z.string(),
  logoUrl: z.string().url().optional(),
});

export const resolveWebsiteQuerySchema = z.object({
  domain: z.string().min(1),
  path: z.string().default("/"),
});

export const publicAvailabilityQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: idSchema,
});

export type Section = z.infer<typeof sectionSchema>;
export type LayoutSchema = z.infer<typeof layoutSchemaSchema>;
export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type ResolveWebsiteQuery = z.infer<typeof resolveWebsiteQuerySchema>;
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;
