import { z } from "zod";

export const sendMessageRequestSchema = z.object({
  content: z.string().min(1),
});

export const inboxPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const threadStatusSchema = z.enum(["open", "closed", "archived"]);

export const listThreadsQuerySchema = inboxPaginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  status: threadStatusSchema.optional(),
});

export const updateThreadStatusSchema = z.object({
  status: threadStatusSchema,
});

export const inboxAutomationJobSchema = z.object({});

// Shared by apps/api-server (subscriber) and packages/queue (publisher) so both sides
// of the Redis pub/sub channel name are always derived from a single source.
export function inboxChannelForAccount(accountId: string): string {
  return `inbox:${accountId}`;
}

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type InboxPaginationQuery = z.infer<typeof inboxPaginationQuerySchema>;
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;
export type UpdateThreadStatusRequest = z.infer<typeof updateThreadStatusSchema>;
export type InboxAutomationJob = z.infer<typeof inboxAutomationJobSchema>;
