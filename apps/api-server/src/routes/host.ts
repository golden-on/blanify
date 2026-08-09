import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { TenantAccessError, blockDatesRequestSchema, createPropertyRequestSchema, createUnitRequestSchema } from "@repo/shared-types";
import {
  blockUnitDates,
  createProperty,
  createUnit,
  getReservationDetail,
  getUnitCalendar,
  listUnitsForAccount,
  unblockUnitDates,
} from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const dateRangeQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function sendTenantAccessDenied(reply: FastifyReply, err: TenantAccessError) {
  return reply.code(403).send({ error: { code: err.code, message: err.message } });
}

const hostPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerHostRoutes(app: FastifyInstance) {
  app.post("/api/v1/host/properties", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createPropertyRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "name is required" } });
    }

    const property = await createProperty(request.accountId!, bodyResult.data);
    return reply.code(201).send({ property });
  });

  app.post("/api/v1/host/units", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createUnitRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "propertyId and name are required" } });
    }

    try {
      const unit = await createUnit(request.accountId!, bodyResult.data);
      return reply.code(201).send({ unit });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.get("/api/v1/host/units", { preHandler: hostPreHandler }, async (request, reply) => {
    const units = await listUnitsForAccount(request.accountId!);
    return reply.code(200).send({ units });
  });

  app.get("/api/v1/host/units/:unitId/calendar", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { unitId: string };
    const queryResult = dateRangeQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "start and end (YYYY-MM-DD) are required" } });
    }

    try {
      const nights = await getUnitCalendar(request.accountId!, params.unitId, queryResult.data.start, queryResult.data.end);
      return reply.code(200).send({ nights });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.post("/api/v1/host/units/:unitId/block", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { unitId: string };
    const bodyResult = blockDatesRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "dates must be a non-empty array of YYYY-MM-DD strings" } });
    }

    try {
      await blockUnitDates(request.accountId!, params.unitId, bodyResult.data.dates);
      return reply.code(200).send({ status: "blocked" });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.post("/api/v1/host/units/:unitId/unblock", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { unitId: string };
    const bodyResult = blockDatesRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "dates must be a non-empty array of YYYY-MM-DD strings" } });
    }

    try {
      await unblockUnitDates(request.accountId!, params.unitId, bodyResult.data.dates);
      return reply.code(200).send({ status: "unblocked" });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.get("/api/v1/host/reservations/:reservationId", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { reservationId: string };
    const detail = await getReservationDetail(request.accountId!, params.reservationId);
    if (!detail) {
      return reply.code(404).send({ error: { code: "RESERVATION_NOT_FOUND", message: `No reservation found for id ${params.reservationId}` } });
    }

    return reply.code(200).send(detail);
  });
}
