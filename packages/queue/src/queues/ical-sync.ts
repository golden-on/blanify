import { Queue } from "bullmq";
import type { IcalSyncJob } from "@repo/shared-types";
import { connection } from "../connection";

export const ICAL_SYNC_QUEUE = "ical-sync";
export const ICAL_SYNC_DLQ = "ical-sync-dlq";

export const icalSyncQueue = new Queue<IcalSyncJob>(ICAL_SYNC_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const icalSyncDlq = new Queue<IcalSyncJob>(ICAL_SYNC_DLQ, { connection });

export async function enqueueIcalSync(job: IcalSyncJob) {
  return icalSyncQueue.add("sync", job);
}
