import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, users, accounts } from "@repo/db";
import { buildApp } from "../app";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("POST /api/v1/auth/register and /login", () => {
  const email = "route-test-owner@example.com";
  let accountId: string | undefined;

  afterAll(async () => {
    if (accountId) {
      await db.delete(users).where(eq(users.accountId, accountId));
      await db.delete(accounts).where(eq(accounts.id, accountId));
    }
  }, 20000);

  it("registers a new account and returns a working token", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { accountName: "Route Test Tenant", email, password: "correct-horse" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { token: string; accountId: string };
    expect(body.token).toEqual(expect.any(String));
    accountId = body.accountId;

    const protectedResponse = await app.inject({
      method: "GET",
      url: "/api/v1/inbox/threads",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(protectedResponse.statusCode).toBe(200);

    await app.close();
  }, 20000);

  it("rejects registering the same email twice", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { accountName: "Another Tenant", email, password: "another-password" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EMAIL_TAKEN");

    await app.close();
  }, 20000);

  it("logs in with the correct password and rejects the wrong one", async () => {
    const app = buildApp();

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "not-the-password" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_CREDENTIALS");

    const right = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "correct-horse" },
    });
    expect(right.statusCode).toBe(200);
    const body = right.json() as { token: string; accountId: string };
    expect(body.accountId).toBe(accountId);

    await app.close();
  }, 20000);
});
