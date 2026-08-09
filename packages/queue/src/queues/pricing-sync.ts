import { Queue } from "bullmq";
import type { PricingSyncJob } from "@repo/shared-types";
import { connection } from "../connection";

export const PRICING_SYNC_QUEUE = "pricing-sync";
export const PRICING_SYNC_DLQ = "pricing-sync-dlq";

export const pricingSyncQueue = new Queue<PricingSyncJob>(PRICING_SYNC_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const pricingSyncDlq = new Queue<PricingSyncJob>(PRICING_SYNC_DLQ, { connection });

export async function enqueuePricingSync(job: PricingSyncJob) {
  return pricingSyncQueue.add("sync", job);
}
