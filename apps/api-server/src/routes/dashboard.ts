import type { FastifyInstance } from "fastify";
import { getDashboardSummary } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/dashboard", { preHandler: hostPreHandler }, async (request, reply) => {
    const dashboard = await getDashboardSummary(request.accountId!);
    return reply.code(200).send(dashboard);
  });
}
