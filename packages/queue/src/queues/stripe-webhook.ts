import { Queue } from "bullmq";
import type { StripeWebhookJob } from "@repo/shared-types";
import { connection } from "../connection";

export const STRIPE_WEBHOOK_QUEUE = "stripe-webhook";
export const STRIPE_WEBHOOK_DLQ = "stripe-webhook-dlq";

export const stripeWebhookQueue = new Queue<StripeWebhookJob>(STRIPE_WEBHOOK_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const stripeWebhookDlq = new Queue<StripeWebhookJob>(STRIPE_WEBHOOK_DLQ, { connection });

export async function enqueueStripeWebhook(job: StripeWebhookJob) {
  return stripeWebhookQueue.add("process", job);
}
