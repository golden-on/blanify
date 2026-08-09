import { Queue } from "bullmq";
import type { InboxAutomationJob } from "@repo/shared-types";
import { connection } from "../connection";

export const INBOX_AUTOMATION_QUEUE = "inbox-automation";
export const INBOX_AUTOMATION_DLQ = "inbox-automation-dlq";

const HOURLY_MS = 60 * 60 * 1000;

export const inboxAutomationQueue = new Queue<InboxAutomationJob>(INBOX_AUTOMATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const inboxAutomationDlq = new Queue<InboxAutomationJob>(INBOX_AUTOMATION_DLQ, { connection });

// Re-adding a repeatable job with identical repeat options is idempotent in BullMQ,
// so calling this on every worker process startup does not create duplicate schedules.
export async function scheduleInboxAutomation() {
  return inboxAutomationQueue.add("evaluate", {}, { repeat: { every: HOURLY_MS } });
}
