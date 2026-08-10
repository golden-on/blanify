import { Queue } from "bullmq";
import type { InvoiceGenerationJob } from "@repo/shared-types";
import { connection } from "../connection";

export const INVOICE_GENERATION_QUEUE = "invoice-generation";
export const INVOICE_GENERATION_DLQ = "invoice-generation-dlq";

export const invoiceGenerationQueue = new Queue<InvoiceGenerationJob>(INVOICE_GENERATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const invoiceGenerationDlq = new Queue<InvoiceGenerationJob>(INVOICE_GENERATION_DLQ, { connection });

export async function enqueueInvoiceGeneration(job: InvoiceGenerationJob) {
  return invoiceGenerationQueue.add("generate", job);
}
