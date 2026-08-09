import type { FastifyInstance } from "fastify";
import { idSchema, pricingProviderSchema, pricingWebhookBodySchema } from "@repo/shared-types";
import { getActivePricingIntegration } from "@repo/db";
import { enqueuePricingSync } from "@repo/queue";

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length);
}

export async function registerPricingWebhookRoutes(app: FastifyInstance) {
  app.post("/api/v1/webhooks/pricing/:provider/:accountId", async (request, reply) => {
    const params = request.params as { provider: string; accountId: string };

    const providerResult = pricingProviderSchema.safeParse(params.provider);
    const accountIdResult = idSchema.safeParse(params.accountId);
    if (!providerResult.success || !accountIdResult.success) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_PARAMS", message: "provider and accountId must be valid" } });
    }
    const provider = providerResult.data;
    const accountId = accountIdResult.data;

    const apiKey = extractBearerToken(request.headers.authorization);
    if (!apiKey) {
      return reply
        .code(401)
        .send({ error: { code: "MISSING_API_KEY", message: "Authorization: Bearer <apiKey> is required" } });
    }

    const integration = await getActivePricingIntegration(accountId, provider);
    if (!integration || integration.apiKey !== apiKey) {
      return reply.code(401).send({ error: { code: "INVALID_API_KEY", message: "Invalid pricing integration API key" } });
    }

    const bodyResult = pricingWebhookBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "Body must be a non-empty array of { unitId, date, priceInCents }" },
      });
    }

    await enqueuePricingSync({ accountId, updates: bodyResult.data });

    return reply.code(202).send({ status: "accepted" });
  });
}
