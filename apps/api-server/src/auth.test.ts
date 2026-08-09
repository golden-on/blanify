import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { requireAuth, signToken } from "./auth";

function buildTestApp() {
  const app = Fastify();
  app.get("/protected", { preHandler: requireAuth }, async (request) => {
    return { accountId: request.accountId, userId: request.userId };
  });
  return app;
}

describe("requireAuth", () => {
  it("attaches accountId and userId to the request for a valid token", async () => {
    const app = buildTestApp();
    const token = signToken({
      sub: "11111111-1111-1111-1111-111111111111",
      accountId: "22222222-2222-2222-2222-222222222222",
      email: "host@example.com",
    });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accountId: "22222222-2222-2222-2222-222222222222",
      userId: "11111111-1111-1111-1111-111111111111",
    });

    await app.close();
  });

  it("accepts the token via a ?token= query param (for the WebSocket handshake)", async () => {
    const app = buildTestApp();
    const token = signToken({
      sub: "11111111-1111-1111-1111-111111111111",
      accountId: "22222222-2222-2222-2222-222222222222",
      email: "host@example.com",
    });

    const response = await app.inject({ method: "GET", url: `/protected?token=${token}` });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it("returns 401 when no token is provided", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("returns 401 for a malformed token", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("returns 401 for an expired token", async () => {
    const app = buildTestApp();
    const expired = jwt.sign(
      { sub: "11111111-1111-1111-1111-111111111111", accountId: "22222222-2222-2222-2222-222222222222", email: "host@example.com" },
      process.env.AUTH_JWT_SECRET ?? "dev-auth-secret-not-for-production",
      { expiresIn: -10 },
    );

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
