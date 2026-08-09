import { z } from "zod";
import { idSchema } from "./base";

export const sendMessageRequestSchema = z.object({
  accountId: idSchema,
  content: z.string().min(1),
});

export const inboxPaginationQuerySchema = z.object({
  accountId: idSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const suggestReplyRequestSchema = z.object({
  accountId: idSchema,
});

export const inboxAutomationJobSchema = z.object({});

// Shared by apps/api-server (subscriber) and packages/queue (publisher) so both sides
// of the Redis pub/sub channel name are always derived from a single source.
export function inboxChannelForAccount(accountId: string): string {
  return `inbox:${accountId}`;
}

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type InboxPaginationQuery = z.infer<typeof inboxPaginationQuerySchema>;
export type SuggestReplyRequest = z.infer<typeof suggestReplyRequestSchema>;
export type InboxAutomationJob = z.infer<typeof inboxAutomationJobSchema>;
