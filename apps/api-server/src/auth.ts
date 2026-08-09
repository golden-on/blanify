import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authTokenPayloadSchema, type AuthTokenPayload, type UserRole } from "@repo/shared-types";

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
    request.userEmail = payload.email;
    request.userRole = payload.role;
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}

// Composes after requireAuth in a route's preHandler array — requireAuth must run
// first to populate request.userRole, or this always 403s.
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userRole || !roles.includes(request.userRole)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Your role does not permit this action" } });
    }
  };
}
