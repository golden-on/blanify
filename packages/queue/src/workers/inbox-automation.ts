import { Worker, QueueEvents } from "bullmq";
import { inboxAutomationJobSchema, inboxChannelForAccount } from "@repo/shared-types";
import { createCheckoutCleaningTasks, evaluateAutomationRules } from "@repo/db";
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

    // Housekeeping tasks aren't guest messages, so they don't go through
    // automation_rules/automation_dispatches — see packages/db/src/housekeeping.ts.
    // Sharing this hourly tick (rather than a separate queue) matches CLAUDE.md's
    // Phase 9 wording ("inside the hourly automation worker").
    const cleaningTasksCreated = await createCheckoutCleaningTasks();

    return { dispatched: dispatches.length, cleaningTasksCreated };
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
