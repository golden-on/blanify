import type { FastifyInstance } from "fastify";
import { createDiscountRequestSchema } from "@repo/shared-types";
import { createDiscount, deleteDiscount, listDiscountsForAccount } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerDiscountRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/discounts", { preHandler: hostPreHandler }, async (request, reply) => {
    const discounts = await listDiscountsForAccount(request.accountId!);
    return reply.code(200).send({ discounts });
  });

  app.post("/api/v1/host/discounts", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createDiscountRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "code, discountType, value, validFrom, and validTo are required" },
      });
    }

    const discount = await createDiscount(request.accountId!, bodyResult.data);
    return reply.code(201).send({ discount });
  });

  app.delete("/api/v1/host/discounts/:discountId", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { discountId: string };
    await deleteDiscount(request.accountId!, params.discountId);
    return reply.code(204).send();
  });
}
