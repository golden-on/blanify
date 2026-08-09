import { asc, desc, eq, sql } from "drizzle-orm";
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

export async function listThreads(accountId: string, { page, pageSize }: PageParams) {
  return withTenant(accountId, async (tx) => {
    const offset = (page - 1) * pageSize;

    const rows = await tx
      .select({
        thread: threads,
        unreadCount: sql<number>`count(${messages.id}) filter (where ${messages.isRead} = false)`.mapWith(Number),
        // Correlated subquery for the sidebar's "last message preview" — cheaper than an
        // extra per-thread round trip, and the aggregate query above can't otherwise
        // single out one specific message's content once messages are joined+grouped.
        lastMessagePreview: sql<string | null>`(select m2.content from messages m2 where m2.thread_id = ${threads.id} order by m2.created_at desc limit 1)`,
      })
      .from(threads)
      .leftJoin(messages, eq(messages.threadId, threads.id))
      .groupBy(threads.id)
      .orderBy(desc(threads.lastMessageAt))
      .limit(pageSize)
      .offset(offset);

    return rows.map(({ thread, unreadCount, lastMessagePreview }) => ({ ...thread, unreadCount, lastMessagePreview }));
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
