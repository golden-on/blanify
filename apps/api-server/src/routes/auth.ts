import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { loginRequestSchema, registerRequestSchema } from "@repo/shared-types";
import { createAccountWithOwner, getUserByEmail } from "@repo/db";
import { signToken } from "../auth";

const BCRYPT_SALT_ROUNDS = 10;

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/v1/auth/register", async (request, reply) => {
    const bodyResult = registerRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "accountName, email, and a password of at least 8 characters are required" },
      });
    }
    const { accountName, email, password } = bodyResult.data;

    const existing = await getUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: { code: "EMAIL_TAKEN", message: "An account with this email already exists" } });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const { account, user } = await createAccountWithOwner({ accountName, email, passwordHash });

    const token = signToken({ sub: user.id, accountId: account.id, email: user.email });
    return reply.code(201).send({ token, accountId: account.id });
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const bodyResult = loginRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "email and password are required" } });
    }
    const { email, password } = bodyResult.data;

    const user = await getUserByEmail(email);
    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password" } });
    }

    const token = signToken({ sub: user.id, accountId: user.accountId, email: user.email });
    return reply.code(200).send({ token, accountId: user.accountId });
  });
}
