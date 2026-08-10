import { z } from "zod";
import { idSchema } from "./base";

export const invoiceLineItemSchema = z.object({
  label: z.string(),
  amountInCents: z.number().int(),
});

export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>;

export const invoiceGenerationJobSchema = z.object({
  accountId: idSchema,
  reservationId: idSchema,
  paymentId: idSchema,
  subtotalInCents: z.number().int().nonnegative(),
  taxInCents: z.number().int().nonnegative(),
  lineItems: z.array(invoiceLineItemSchema),
});

export type InvoiceGenerationJob = z.infer<typeof invoiceGenerationJobSchema>;
