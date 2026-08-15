import { z } from "zod";
import { idSchema } from "./base";

export const createIcalFeedSchema = z.object({
  unitId: idSchema,
  name: z.string().min(1),
  url: z.string().url(),
});

export const channelStatusSchema = z.object({
  channel: z.enum(["airbnb", "booking", "google_vacation_rentals", "ical"]),
  status: z.enum(["connected", "error", "disconnected", "not_connected"]),
  lastSyncedAt: z.string().datetime().nullable(),
});

export type CreateIcalFeedRequest = z.infer<typeof createIcalFeedSchema>;
export type ChannelStatus = z.infer<typeof channelStatusSchema>;
