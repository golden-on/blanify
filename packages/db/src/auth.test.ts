import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { createAccountWithOwner, getUserByEmail } from "./auth";
import { accounts } from "./schema/accounts";
import { users } from "./schema/users";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("createAccountWithOwner / getUserByEmail", () => {
  const email = "owner-round-trip@example.com";
  let accountId: string | undefined;

  afterAll(async () => {
    if (accountId) {
      await db.delete(users).where(eq(users.accountId, accountId));
      await db.delete(accounts).where(eq(accounts.id, accountId));
    }
  }, 20000);

  it("creates an account and its owner user in one transaction, and getUserByEmail finds it", async () => {
    const { account, user } = await createAccountWithOwner({
      accountName: "Round Trip Tenant",
      email,
      passwordHash: "hashed-value",
    });
    accountId = account.id;

    expect(user.accountId).toBe(account.id);
    expect(user.email).toBe(email);

    const found = await getUserByEmail(email);
    expect(found?.id).toBe(user.id);
    expect(found?.accountId).toBe(account.id);
  }, 20000);

  it("rejects a second user with the same email via the unique constraint", async () => {
    await expect(
      createAccountWithOwner({ accountName: "Duplicate Tenant", email, passwordHash: "hashed-value-2" }),
    ).rejects.toThrow();
  }, 20000);
});
