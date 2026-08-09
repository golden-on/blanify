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

describe.skipIf(!reachable)("WS /api/v1/inbox/ws", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };
  let thread: { id: string };
  let token: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Inbox WS Test Tenant" }).returning())[0]!;
    token = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com" });

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
        .values({ accountId: account.id, unitId: unit.id, guestName: "WS Guest", channel: "direct" })
        .returning();
      return row!;
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(messages).where(eq(messages.threadId, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.id, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("broadcasts a newly posted message to a connected socket for the same tenant", async () => {
    const app = buildApp();
    await app.ready();

    const ws = await app.injectWS(`/api/v1/inbox/ws?token=${token}`);

    const messageReceived = new Promise<string>((resolve) => {
      ws.once("message", (data: Buffer) => resolve(data.toString()));
    });

    // Give the Redis SUBSCRIBE a brief moment to land before publishing.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const postResponse = await app.inject({
      method: "POST",
      url: `/api/v1/inbox/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "Hello via WS test" },
    });
    expect(postResponse.statusCode).toBe(201);

    const raw = await Promise.race([
      messageReceived,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("WS message timeout")), 10000)),
    ]);
    const parsed = JSON.parse(raw) as { threadId: string; message: { content: string } };
    expect(parsed.threadId).toBe(thread.id);
    expect(parsed.message.content).toBe("Hello via WS test");

    ws.close();
    await app.close();
  }, 20000);

  it("rejects the handshake when no token is provided", async () => {
    const app = buildApp();
    await app.ready();

    await expect(app.injectWS("/api/v1/inbox/ws")).rejects.toBeTruthy();

    await app.close();
  }, 20000);
});
