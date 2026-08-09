import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withTenant, accounts, properties, units, threads, messages } from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("Inbox REST routes", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let property: { id: string };
  let unit: { id: string };
  let thread: { id: string };
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Inbox Route Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Inbox Route Test Tenant B" }).returning())[0]!;

    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com" });

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Unit" })
        .returning();
      return row!;
    });
    thread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(threads)
        .values({ accountId: account.id, unitId: unit.id, guestName: "Guest One", channel: "airbnb" })
        .returning();
      return row!;
    });

    await withTenant(account.id, (tx) =>
      tx.insert(messages).values([
        { accountId: account.id, threadId: thread.id, senderType: "guest", content: "Hi there", isRead: true },
        { accountId: account.id, threadId: thread.id, senderType: "guest", content: "Are you there?", isRead: false },
      ]),
    );
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(messages).where(eq(messages.threadId, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.id, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("returns 401 without a token", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/inbox/threads" });
    expect(response.statusCode).toBe(401);
    await app.close();
  }, 20000);

  it("lists threads with correct unread counts for the owning tenant", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/inbox/threads",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]).toMatchObject({ id: thread.id, guestName: "Guest One", unreadCount: 1 });

    await app.close();
  }, 20000);

  it("returns no threads when queried under a different tenant's token", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/inbox/threads",
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().threads).toEqual([]);

    await app.close();
  }, 20000);

  it("posts a host message, bumps lastMessageAt, and it appears in message history", async () => {
    const app = buildApp();

    const [beforeThread] = await withTenant(account.id, (tx) => tx.select().from(threads).where(eq(threads.id, thread.id)));

    const postResponse = await app.inject({
      method: "POST",
      url: `/api/v1/inbox/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "Thanks for reaching out!" },
    });
    expect(postResponse.statusCode).toBe(201);
    expect(postResponse.json().message).toMatchObject({
      senderType: "host",
      content: "Thanks for reaching out!",
      isRead: true,
    });

    const [afterThread] = await withTenant(account.id, (tx) => tx.select().from(threads).where(eq(threads.id, thread.id)));
    expect(afterThread!.lastMessageAt.getTime()).toBeGreaterThan(beforeThread!.lastMessageAt.getTime());

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/inbox/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(historyResponse.statusCode).toBe(200);
    const historyBody = historyResponse.json() as { messages: Array<{ content: string }> };
    expect(historyBody.messages.some((m) => m.content === "Thanks for reaching out!")).toBe(true);

    await app.close();
  }, 20000);
});
