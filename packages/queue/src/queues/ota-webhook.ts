import { Queue } from "bullmq";
import type { OtaWebhookJob } from "@repo/shared-types";
import { connection } from "../connection";

export const OTA_WEBHOOK_QUEUE = "ota-webhook";
export const OTA_WEBHOOK_DLQ = "ota-webhook-dlq";

export const otaWebhookQueue = new Queue<OtaWebhookJob>(OTA_WEBHOOK_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const otaWebhookDlq = new Queue<OtaWebhookJob>(OTA_WEBHOOK_DLQ, { connection });

export async function enqueueOtaWebhook(job: OtaWebhookJob) {
  return otaWebhookQueue.add("process", job);
}
