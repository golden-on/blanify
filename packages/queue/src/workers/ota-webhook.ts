import { Worker, QueueEvents } from "bullmq";
import { otaWebhookJobSchema } from "@repo/shared-types";
import { processOtaWebhookEvent } from "@repo/channel-sync";
import { connection } from "../connection";
import { OTA_WEBHOOK_QUEUE, otaWebhookQueue, otaWebhookDlq } from "../queues/ota-webhook";

export const otaWebhookWorker = new Worker(
  OTA_WEBHOOK_QUEUE,
  async (job) => {
    const { webhookEventId } = otaWebhookJobSchema.parse(job.data);
    await processOtaWebhookEvent(webhookEventId);
  },
  { connection },
);

export const otaWebhookEvents = new QueueEvents(OTA_WEBHOOK_QUEUE, { connection });

otaWebhookEvents.on("failed", async ({ jobId }) => {
  const job = await otaWebhookQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await otaWebhookDlq.add("dead-letter", job.data);
  }
});

otaWebhookWorker.on("ready", () => {
  console.log("OTA webhook worker ready");
});
