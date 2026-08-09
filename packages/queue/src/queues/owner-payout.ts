import { Queue } from "bullmq";
import { connection } from "../connection";

export const OWNER_PAYOUT_QUEUE = "owner-payout";
export const OWNER_PAYOUT_DLQ = "owner-payout-dlq";

export const ownerPayoutQueue = new Queue<Record<string, never>>(OWNER_PAYOUT_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const ownerPayoutDlq = new Queue<Record<string, never>>(OWNER_PAYOUT_DLQ, { connection });

// Re-adding a repeatable job with identical repeat options is idempotent in BullMQ,
// so calling this on every worker process startup does not create duplicate schedules.
// Runs on the 1st of each month; generateMonthlyPayoutStatements() itself computes
// the *previous* full calendar month as the statement period.
export async function scheduleOwnerPayout() {
  return ownerPayoutQueue.add("generate", {}, { repeat: { pattern: "0 0 1 * *" } });
}
