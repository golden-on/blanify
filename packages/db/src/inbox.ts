import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { ThreadStatus } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { threads } from "./schema/threads";
import { messages } from "./schema/messages";
import { reservations } from "./schema/reservations";
import { units } from "./schema/units";
import { properties } from "./schema/properties";

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface ListThreadsFilters extends PageParams {
  search?: string;
  status?: ThreadStatus;
}

export async function listThreads(accountId: string, { page, pageSize, search, status }: ListThreadsFilters) {
  return withTenant(accountId, async (tx) => {
    const offset = (page - 1) * pageSize;

    const conditions = [
      status ? eq(threads.status, status) : undefined,
      search ? or(sql`${threads.guestName} ilike ${`%${search}%`}`, sql`${threads.guestEmail} ilike ${`%${search}%`}`) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await tx
      .select({
        thread: threads,
        unreadCount: sql<number>`count(${messages.id}) filter (where ${messages.isRead} = false)`.mapWith(Number),
        // Correlated subquery for the sidebar's "last message preview" — cheaper than an
        // extra per-thread round trip, and the aggregate query above can't otherwise
        // single out one specific message's content once messages are joined+grouped.
        lastMessagePreview: sql<string | null>`(select m2.content from messages m2 where m2.thread_id = ${threads.id} order by m2.created_at desc limit 1)`,
        // True once anything in the codebase actually inserts a message with
        // senderType 'ai' (nothing does yet — see Phase 15 plan Decision 5).
        hasAiReply: sql<boolean>`exists (select 1 from messages m3 where m3.thread_id = ${threads.id} and m3.sender_type = 'ai')`,
      })
      .from(threads)
      .leftJoin(messages, eq(messages.threadId, threads.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(threads.id)
      .orderBy(desc(threads.lastMessageAt))
      .limit(pageSize)
      .offset(offset);

    return rows.map(({ thread, unreadCount, lastMessagePreview, hasAiReply }) => ({
      ...thread,
      unreadCount,
      lastMessagePreview,
      hasAiReply,
    }));
  });
}

export async function countOpenThreads(accountId: string): Promise<number> {
  return withTenant(accountId, async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
      .from(threads)
      .where(eq(threads.status, "open"));
    return row?.count ?? 0;
  });
}

export async function updateThreadStatus(accountId: string, threadId: string, status: ThreadStatus) {
  return withTenant(accountId, async (tx) => {
    const [thread] = await tx
      .update(threads)
      .set({ status, updatedAt: new Date() })
      .where(eq(threads.id, threadId))
      .returning();
    return thread ?? null;
  });
}

export async function getThreadMessages(accountId: string, threadId: string, { page, pageSize }: PageParams) {
  return withTenant(accountId, async (tx) => {
    const offset = (page - 1) * pageSize;
    return tx
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))
      .limit(pageSize)
      .offset(offset);
  });
}

export async function createHostMessage(accountId: string, threadId: string, content: string) {
  return withTenant(accountId, async (tx) => {
    const [message] = await tx
      .insert(messages)
      .values({ accountId, threadId, senderType: "host", content, isRead: true })
      .returning();

    if (!message) {
      throw new Error("Failed to create message");
    }

    await tx.update(threads).set({ lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(threads.id, threadId));

    return message;
  });
}

export async function getThreadContext(accountId: string, threadId: string) {
  return withTenant(accountId, async (tx) => {
    const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId));
    if (!thread) {
      return null;
    }

    const [reservation] = thread.reservationId
      ? await tx.select().from(reservations).where(eq(reservations.id, thread.reservationId))
      : [undefined];

    const unitId = reservation?.unitId ?? thread.unitId ?? undefined;
    const [unit] = unitId ? await tx.select().from(units).where(eq(units.id, unitId)) : [undefined];
    const [property] = unit ? await tx.select().from(properties).where(eq(properties.id, unit.propertyId)) : [undefined];

    return { thread, reservation: reservation ?? null, unit: unit ?? null, property: property ?? null };
  });
}
