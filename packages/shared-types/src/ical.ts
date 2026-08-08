import { z } from "zod";
import { idSchema } from "./base";

export const icalSyncJobSchema = z.object({
  feedId: idSchema,
  accountId: idSchema,
});

export type IcalSyncJob = z.infer<typeof icalSyncJobSchema>;
