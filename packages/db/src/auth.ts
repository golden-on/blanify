import { eq } from "drizzle-orm";
import { db } from "./client";
import { accounts } from "./schema/accounts";
import { users } from "./schema/users";

export interface CreateAccountWithOwnerInput {
  accountName: string;
  email: string;
  passwordHash: string;
}

export async function createAccountWithOwner(input: CreateAccountWithOwnerInput) {
  return db.transaction(async (tx) => {
    const [account] = await tx.insert(accounts).values({ name: input.accountName }).returning();
    if (!account) {
      throw new Error("Failed to create account");
    }

    const [user] = await tx
      .insert(users)
      .values({ accountId: account.id, email: input.email, passwordHash: input.passwordHash, role: "owner" })
      .returning();
    if (!user) {
      throw new Error("Failed to create user");
    }

    return { account, user };
  });
}

export async function getUserByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row;
}
