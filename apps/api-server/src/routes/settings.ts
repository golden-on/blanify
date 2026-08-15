import type { FastifyInstance } from "fastify";
import { getStripeAccountForTenant, listSmartLocksForAccount } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/stripe-account", { preHandler: hostPreHandler }, async (request, reply) => {
    const stripeAccount = await getStripeAccountForTenant(request.accountId!);
    return reply.code(200).send({ stripeAccount: stripeAccount ?? null });
  });

  app.get("/api/v1/host/smart-locks", { preHandler: hostPreHandler }, async (request, reply) => {
    const smartLocks = await listSmartLocksForAccount(request.accountId!);
    return reply.code(200).send({ smartLocks });
  });
}
