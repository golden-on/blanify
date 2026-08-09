import { Worker, QueueEvents } from "bullmq";
import { pricingSyncJobSchema } from "@repo/shared-types";
import { bulkUpdateNightlyRates } from "@repo/db";
import { connection } from "../connection";
import { PRICING_SYNC_QUEUE, pricingSyncQueue, pricingSyncDlq } from "../queues/pricing-sync";

export const pricingSyncWorker = new Worker(
  PRICING_SYNC_QUEUE,
  async (job) => {
    const { accountId, updates } = pricingSyncJobSchema.parse(job.data);
    const updatedCount = await bulkUpdateNightlyRates(accountId, updates);
    return { updatedCount };
  },
  { connection },
);

export const pricingSyncEvents = new QueueEvents(PRICING_SYNC_QUEUE, { connection });

pricingSyncEvents.on("failed", async ({ jobId }) => {
  const job = await pricingSyncQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await pricingSyncDlq.add("dead-letter", job.data);
  }
});

pricingSyncWorker.on("ready", () => {
  console.log("Pricing sync worker ready");
});
