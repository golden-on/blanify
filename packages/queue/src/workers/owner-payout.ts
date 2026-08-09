import { Worker, QueueEvents } from "bullmq";
import { generateMonthlyPayoutStatements } from "@repo/db";
import { connection } from "../connection";
import { OWNER_PAYOUT_QUEUE, ownerPayoutQueue, ownerPayoutDlq, scheduleOwnerPayout } from "../queues/owner-payout";

export const ownerPayoutWorker = new Worker(
  OWNER_PAYOUT_QUEUE,
  async () => {
    const created = await generateMonthlyPayoutStatements();
    return { created };
  },
  { connection },
);

export const ownerPayoutEvents = new QueueEvents(OWNER_PAYOUT_QUEUE, { connection });

ownerPayoutEvents.on("failed", async ({ jobId }) => {
  const job = await ownerPayoutQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await ownerPayoutDlq.add("dead-letter", job.data);
  }
});

ownerPayoutWorker.on("ready", () => {
  console.log("Owner payout worker ready");
});

void scheduleOwnerPayout();
