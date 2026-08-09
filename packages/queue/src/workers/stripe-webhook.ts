import { Worker, QueueEvents } from "bullmq";
import { stripeWebhookJobSchema } from "@repo/shared-types";
import { processStripeWebhookEvent } from "@repo/db";
import { connection } from "../connection";
import { STRIPE_WEBHOOK_QUEUE, stripeWebhookQueue, stripeWebhookDlq } from "../queues/stripe-webhook";
import { enqueueSmartLockAccess } from "../queues/smart-lock-access";

export const stripeWebhookWorker = new Worker(
  STRIPE_WEBHOOK_QUEUE,
  async (job) => {
    const { webhookEventId } = stripeWebhookJobSchema.parse(job.data);
    const result = await processStripeWebhookEvent(webhookEventId);
    if (result) {
      await enqueueSmartLockAccess(result);
    }
  },
  { connection },
);

export const stripeWebhookEvents = new QueueEvents(STRIPE_WEBHOOK_QUEUE, { connection });

stripeWebhookEvents.on("failed", async ({ jobId }) => {
  const job = await stripeWebhookQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await stripeWebhookDlq.add("dead-letter", job.data);
  }
});

stripeWebhookWorker.on("ready", () => {
  console.log("Stripe webhook worker ready");
});
