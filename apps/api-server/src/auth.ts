import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authTokenPayloadSchema, type AuthTokenPayload } from "@repo/shared-types";

const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "dev-auth-secret-not-for-production";

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function extractToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }

  // WebSocket handshakes can't set custom headers from a browser, so the token also
  // travels as a query param there — the same check covers both REST and WS routes.
  const query = request.query as { token?: string } | undefined;
  return query?.token;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = extractToken(request);
  if (!token) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const payload = authTokenPayloadSchema.parse(decoded);
    request.accountId = payload.accountId;
    request.userId = payload.sub;
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}
