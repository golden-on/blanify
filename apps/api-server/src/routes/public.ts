import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { publicAvailabilityQuerySchema, resolveWebsiteQuerySchema } from "@repo/shared-types";
import { nightlyAvailability, resolvePage, resolveWebsiteByDomain, withTenant } from "@repo/db";

const PUBLIC_CACHE_HEADER = "public, max-age=60";

export async function registerPublicRoutes(app: FastifyInstance) {
  app.get("/api/v1/public/websites/resolve", async (request, reply) => {
    const queryResult = resolveWebsiteQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_QUERY", message: "domain query parameter is required" } });
    }
    const { domain, path } = queryResult.data;

    const website = await resolveWebsiteByDomain(domain);
    if (!website) {
      return reply
        .code(404)
        .send({ error: { code: "WEBSITE_NOT_FOUND", message: `No published website found for domain ${domain}` } });
    }

    const page = await resolvePage(website.id, path);
    if (!page) {
      return reply
        .code(404)
        .send({ error: { code: "PAGE_NOT_FOUND", message: `No published page found for path ${path}` } });
    }

    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return reply.code(200).send({ website, page });
  });

  app.get("/api/v1/public/units/:unitId/availability", async (request, reply) => {
    const params = request.params as { unitId: string };
    const queryResult = publicAvailabilityQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_QUERY", message: "start, end, and accountId query parameters are required" },
      });
    }
    const { start, end, accountId } = queryResult.data;

    const rows = await withTenant(accountId, (tx) =>
      tx
        .select({
          date: nightlyAvailability.date,
          status: nightlyAvailability.status,
          priceInCents: nightlyAvailability.priceInCents,
        })
        .from(nightlyAvailability)
        .where(
          and(
            eq(nightlyAvailability.unitId, params.unitId),
            gte(nightlyAvailability.date, start),
            lte(nightlyAvailability.date, end),
          ),
        )
        .orderBy(asc(nightlyAvailability.date)),
    );

    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return reply.code(200).send({ nights: rows });
  });
}
