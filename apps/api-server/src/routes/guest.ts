import type { FastifyInstance } from "fastify";
import { guestCheckInRequestSchema } from "@repo/shared-types";
import { completeGuestCheckIn, getGuestPortalData } from "@repo/db";

export async function registerGuestRoutes(app: FastifyInstance) {
  app.get("/api/v1/public/guest/:token", async (request, reply) => {
    const params = request.params as { token: string };

    const data = await getGuestPortalData(params.token);
    if (!data) {
      return reply.code(404).send({ error: { code: "GUEST_SESSION_NOT_FOUND", message: "No guest session found for this link" } });
    }

    return reply.code(200).send(data);
  });

  app.post("/api/v1/public/guest/:token/check-in", async (request, reply) => {
    const params = request.params as { token: string };
    const bodyResult = guestCheckInRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "fullName and a valid signatureDataUrl image are required" },
      });
    }

    const updated = await completeGuestCheckIn(params.token, bodyResult.data);
    if (!updated) {
      return reply.code(404).send({ error: { code: "GUEST_SESSION_NOT_FOUND", message: "No guest session found for this link" } });
    }

    return reply.code(200).send({ checkInCompletedAt: updated.checkInCompletedAt });
  });
}
