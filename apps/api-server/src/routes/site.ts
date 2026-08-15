import type { FastifyInstance } from "fastify";
import { updateSiteRequestSchema } from "@repo/shared-types";
import { getOrCreateSite, isSubdomainAvailable, updateSite } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerSiteRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/site", { preHandler: hostPreHandler }, async (request, reply) => {
    const site = await getOrCreateSite(request.accountId!);
    return reply.code(200).send({ site });
  });

  app.patch("/api/v1/host/site", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = updateSiteRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "Invalid site update payload" } });
    }

    if (bodyResult.data.slug !== undefined) {
      const available = await isSubdomainAvailable(bodyResult.data.slug, request.accountId!);
      if (!available) {
        return reply.code(409).send({ error: { code: "SLUG_TAKEN", message: `Slug "${bodyResult.data.slug}" is already in use` } });
      }
    }

    const site = await updateSite(request.accountId!, bodyResult.data);
    return reply.code(200).send({ site });
  });
}
