import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TenantAccessError, createAddOnRequestSchema } from "@repo/shared-types";
import { createAddOn, deleteAddOn, getUnitAddOns } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

const listAddOnsQuerySchema = z.object({ unitId: z.string().uuid() });

export async function registerAddOnRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/add-ons", { preHandler: hostPreHandler }, async (request, reply) => {
    const queryResult = listAddOnsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "unitId is required" } });
    }

    const addOns = await getUnitAddOns(request.accountId!, queryResult.data.unitId);
    return reply.code(200).send({ addOns });
  });

  app.post("/api/v1/host/add-ons", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createAddOnRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "unitId, name, priceInCents, and feeType are required" },
      });
    }

    try {
      const addOn = await createAddOn(request.accountId!, bodyResult.data);
      return reply.code(201).send({ addOn });
    } catch (err) {
      if (err instanceof TenantAccessError) {
        return reply.code(403).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  app.delete("/api/v1/host/add-ons/:addOnId", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { addOnId: string };
    await deleteAddOn(request.accountId!, params.addOnId);
    return reply.code(204).send();
  });
}
