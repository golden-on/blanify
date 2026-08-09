import Fastify from "fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, withTenant, accounts, properties, units, threads } from "@repo/db";
import { registerInboxRoutes } from "./inbox";
import type { LLMDriver, SuggestReplyContext } from "../ai/llm-client";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("POST /api/v1/inbox/threads/:threadId/suggest-reply", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };
  let thread: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Suggest Reply Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "Suggest Reply Test Property" })
        .returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({
          accountId: account.id,
          propertyId: property.id,
          name: "Suite 1",
          checkInInstructions: "Use lockbox code 1234 at the side door.",
        })
        .returning();
      return row!;
    });
    thread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(threads)
        .values({ accountId: account.id, unitId: unit.id, guestName: "Ada Guest", channel: "direct" })
        .returning();
      return row!;
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.id, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("assembles thread/unit context and returns the injected driver's draft without a real LLM call", async () => {
    const app = Fastify();
    let capturedContext: SuggestReplyContext | undefined;
    const fakeDriver: LLMDriver = {
      generateReply: vi.fn(async (context: SuggestReplyContext) => {
        capturedContext = context;
        return "Here is a suggested reply.";
      }),
    };

    await registerInboxRoutes(app, { llmDriver: fakeDriver });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/inbox/threads/${thread.id}/suggest-reply`,
      payload: { accountId: account.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ draft: "Here is a suggested reply." });
    expect(fakeDriver.generateReply).toHaveBeenCalledTimes(1);
    expect(capturedContext?.guestName).toBe("Ada Guest");
    expect(capturedContext?.checkInInstructions).toBe("Use lockbox code 1234 at the side door.");

    await app.close();
  }, 20000);

  it("returns 404 for a thread that does not exist under the given account", async () => {
    const app = Fastify();
    const fakeDriver: LLMDriver = { generateReply: vi.fn() };
    await registerInboxRoutes(app, { llmDriver: fakeDriver });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/inbox/threads/00000000-0000-0000-0000-000000000000/suggest-reply",
      payload: { accountId: account.id },
    });

    expect(response.statusCode).toBe(404);
    expect(fakeDriver.generateReply).not.toHaveBeenCalled();

    await app.close();
  }, 20000);
});
