import { Worker, QueueEvents } from "bullmq";
import { inboxAutomationJobSchema, inboxChannelForAccount } from "@repo/shared-types";
import { evaluateAutomationRules } from "@repo/db";
import { connection } from "../connection";
import {
  INBOX_AUTOMATION_QUEUE,
  inboxAutomationQueue,
  inboxAutomationDlq,
  scheduleInboxAutomation,
} from "../queues/inbox-automation";

export const inboxAutomationWorker = new Worker(
  INBOX_AUTOMATION_QUEUE,
  async (job) => {
    inboxAutomationJobSchema.parse(job.data);
    const dispatches = await evaluateAutomationRules();

    for (const { accountId, threadId, message } of dispatches) {
      // PUBLISH is a normal Redis command, safe to run on the shared BullMQ
      // connection (unlike SUBSCRIBE, which requires a dedicated connection).
      await connection.publish(inboxChannelForAccount(accountId), JSON.stringify({ threadId, message }));
    }

    return { dispatched: dispatches.length };
  },
  { connection },
);

export const inboxAutomationEvents = new QueueEvents(INBOX_AUTOMATION_QUEUE, { connection });

inboxAutomationEvents.on("failed", async ({ jobId }) => {
  const job = await inboxAutomationQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await inboxAutomationDlq.add("dead-letter", job.data);
  }
});

inboxAutomationWorker.on("ready", () => {
  console.log("Inbox automation worker ready");
});

void scheduleInboxAutomation();
