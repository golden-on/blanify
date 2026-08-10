import { Worker, QueueEvents } from "bullmq";
import { invoiceGenerationJobSchema } from "@repo/shared-types";
import { createInvoiceForReservation } from "@repo/db";
import { connection } from "../connection";
import {
  INVOICE_GENERATION_QUEUE,
  invoiceGenerationQueue,
  invoiceGenerationDlq,
} from "../queues/invoice-generation";

export const invoiceGenerationWorker = new Worker(
  INVOICE_GENERATION_QUEUE,
  async (job) => {
    const input = invoiceGenerationJobSchema.parse(job.data);
    const invoice = await createInvoiceForReservation(input);
    return { invoiceId: invoice?.id ?? null };
  },
  { connection },
);

export const invoiceGenerationEvents = new QueueEvents(INVOICE_GENERATION_QUEUE, { connection });

invoiceGenerationEvents.on("failed", async ({ jobId }) => {
  const job = await invoiceGenerationQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await invoiceGenerationDlq.add("dead-letter", job.data);
  }
});

invoiceGenerationWorker.on("ready", () => {
  console.log("Invoice generation worker ready");
});
