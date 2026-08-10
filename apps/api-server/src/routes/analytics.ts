import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAnalyticsSummary, getDailyAnalyticsSeries } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const analyticsQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const analyticsPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/analytics", { preHandler: analyticsPreHandler }, async (request, reply) => {
    const queryResult = analyticsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "start and end (YYYY-MM-DD) are required" } });
    }
    const { start, end } = queryResult.data;

    if (start > end) {
      return reply.code(400).send({ error: { code: "INVALID_DATE_RANGE", message: "end must not be before start" } });
    }

    const accountId = request.accountId!;
    const [summary, daily] = await Promise.all([
      getAnalyticsSummary(accountId, start, end),
      getDailyAnalyticsSeries(accountId, start, end),
    ]);

    return reply.code(200).send({ summary, daily });
  });
}
