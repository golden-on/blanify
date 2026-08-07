import { sql, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../client";
import { withTenant } from "../tenant-context";
import { accounts } from "./accounts";
import { properties } from "./properties";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("tenant isolation (RLS)", () => {
  let accountA: { id: string };
  let accountB: { id: string };

  beforeAll(async () => {
    accountA = (await db.insert(accounts).values({ name: "Tenant A" }).returning())[0]!;
    accountB = (await db.insert(accounts).values({ name: "Tenant B" }).returning())[0]!;

    await withTenant(accountA.id, (tx) =>
      tx.insert(properties).values({ accountId: accountA.id, name: "A Property" }),
    );
    await withTenant(accountB.id, (tx) =>
      tx.insert(properties).values({ accountId: accountB.id, name: "B Property" }),
    );
  });

  afterAll(async () => {
    await withTenant(accountA.id, (tx) =>
      tx.delete(properties).where(eq(properties.accountId, accountA.id)),
    );
    await withTenant(accountB.id, (tx) =>
      tx.delete(properties).where(eq(properties.accountId, accountB.id)),
    );
    await db.delete(accounts).where(eq(accounts.id, accountA.id));
    await db.delete(accounts).where(eq(accounts.id, accountB.id));
  });

  it("only returns the scoped tenant's rows", async () => {
    const rowsA = await withTenant(accountA.id, (tx) => tx.select().from(properties));
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.name).toBe("A Property");

    const rowsB = await withTenant(accountB.id, (tx) => tx.select().from(properties));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.name).toBe("B Property");
  });

  it("returns zero rows when no tenant context is set", async () => {
    const rows = await db.select().from(properties);
    expect(rows).toHaveLength(0);
  });
});
