import { Worker, QueueEvents } from "bullmq";
import { icalSyncJobSchema } from "@repo/shared-types";
import { syncICalFeed } from "@repo/channel-sync";
import { connection } from "../connection";
import { ICAL_SYNC_QUEUE, icalSyncQueue, icalSyncDlq } from "../queues/ical-sync";

export const icalSyncWorker = new Worker(
  ICAL_SYNC_QUEUE,
  async (job) => {
    const { feedId, accountId } = icalSyncJobSchema.parse(job.data);
    await syncICalFeed(feedId, accountId);
  },
  { connection },
);

export const icalSyncEvents = new QueueEvents(ICAL_SYNC_QUEUE, { connection });

icalSyncEvents.on("failed", async ({ jobId }) => {
  const job = await icalSyncQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await icalSyncDlq.add("dead-letter", job.data);
  }
});

icalSyncWorker.on("ready", () => {
  console.log("iCal sync worker ready");
});
