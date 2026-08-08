import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { webhookPayloadSchema } from "@repo/shared-types";
import { recordWebhookEvent } from "@repo/db";
import {
  verifyChannelSignature,
  SUPPORTED_WEBHOOK_CHANNELS,
  type SupportedWebhookChannel,
} from "@repo/channel-sync";
import { enqueueOtaWebhook } from "@repo/queue";

const channelParamSchema = z.enum(SUPPORTED_WEBHOOK_CHANNELS);

function signatureHeaderName(channel: SupportedWebhookChannel): string {
  return channel === "airbnb" ? "x-airbnb-signature" : "x-booking-signature";
}

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post("/api/v1/webhooks/:channel", async (request, reply) => {
    const params = request.params as { channel: string };
    const channelResult = channelParamSchema.safeParse(params.channel);
    if (!channelResult.success) {
      return reply
        .code(400)
        .send({ error: { code: "UNSUPPORTED_CHANNEL", message: "Unsupported webhook channel" } });
    }
    const channel = channelResult.data;

    const signatureHeader = request.headers[signatureHeaderName(channel)];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!verifyChannelSignature(channel, request.rawBody ?? "", signature)) {
      return reply
        .code(401)
        .send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
    }

    const payloadResult = webhookPayloadSchema.safeParse(request.body);
    if (!payloadResult.success) {
      return reply
        .code(400)
        .send({ error: { code: "INVALID_PAYLOAD", message: "Webhook payload failed validation" } });
    }
    const payload = payloadResult.data;

    const event = await recordWebhookEvent(channel, payload.eventId, payload);
    if (!event) {
      return reply.code(200).send({ status: "duplicate" });
    }

    await enqueueOtaWebhook({ webhookEventId: event.id });
    return reply.code(202).send({ status: "accepted" });
  });
}
