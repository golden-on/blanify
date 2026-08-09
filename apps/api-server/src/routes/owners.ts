import type { FastifyInstance, FastifyReply } from "fastify";
import { TenantAccessError, createOwnerRequestSchema, createUnitOwnerRequestSchema } from "@repo/shared-types";
import { createOwner, createUnitOwner, listOwnersForAccount, listStatementsForOwner } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

function sendTenantAccessDenied(reply: FastifyReply, err: TenantAccessError) {
  return reply.code(403).send({ error: { code: err.code, message: err.message } });
}

const ownerPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerOwnerRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/owners", { preHandler: ownerPreHandler }, async (request, reply) => {
    const owners = await listOwnersForAccount(request.accountId!);
    return reply.code(200).send({ owners });
  });

  app.post("/api/v1/host/owners", { preHandler: ownerPreHandler }, async (request, reply) => {
    const bodyResult = createOwnerRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "name, email, and commissionPct are required" } });
    }

    const owner = await createOwner(request.accountId!, bodyResult.data);
    return reply.code(201).send({ owner });
  });

  app.post("/api/v1/host/units/:unitId/owners", { preHandler: ownerPreHandler }, async (request, reply) => {
    const params = request.params as { unitId: string };
    const bodyResult = createUnitOwnerRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "ownerId and splitPct are required" } });
    }

    try {
      const unitOwner = await createUnitOwner(request.accountId!, { unitId: params.unitId, ...bodyResult.data });
      return reply.code(201).send({ unitOwner });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.get("/api/v1/host/owners/:ownerId/statements", { preHandler: ownerPreHandler }, async (request, reply) => {
    const params = request.params as { ownerId: string };
    const statements = await listStatementsForOwner(request.accountId!, params.ownerId);
    return reply.code(200).send({ statements });
  });
}
