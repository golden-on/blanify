import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ConcurrencyError,
  TenantAccessError,
  blockDatesRequestSchema,
  createPropertyRequestSchema,
  createReservationRequestSchema,
  createTaxRuleRequestSchema,
  createUnitRequestSchema,
  listReservationsQuerySchema,
  updateUnitRequestSchema,
} from "@repo/shared-types";
import {
  blockUnitDates,
  createHostReservation,
  createProperty,
  createTaxRule,
  createUnit,
  deleteTaxRule,
  getReservationDetail,
  getUnitCalendar,
  listReservationsForAccount,
  listTaxRulesForAccount,
  listUnitsForAccount,
  unblockUnitDates,
  updateUnit,
} from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const dateRangeQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function sendTenantAccessDenied(reply: FastifyReply, err: TenantAccessError) {
  return reply.code(403).send({ error: { code: err.code, message: err.message } });
}

function sendConcurrencyConflict(reply: FastifyReply, err: ConcurrencyError) {
  return reply.code(409).send({ error: { code: err.code, message: err.message } });
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

  app.patch("/api/v1/host/units/:unitId", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { unitId: string };
    const bodyResult = updateUnitRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "Invalid unit update payload" } });
    }

    try {
      const unit = await updateUnit(request.accountId!, params.unitId, bodyResult.data);
      return reply.code(200).send({ unit });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
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
      await blockUnitDates(request.accountId!, params.unitId, bodyResult.data.dates, bodyResult.data.reason);
      return reply.code(200).send({ status: "blocked" });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      if (err instanceof ConcurrencyError) return sendConcurrencyConflict(reply, err);
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
      if (err instanceof ConcurrencyError) return sendConcurrencyConflict(reply, err);
      throw err;
    }
  });

  app.get("/api/v1/host/reservations", { preHandler: hostPreHandler }, async (request, reply) => {
    const queryResult = listReservationsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Invalid reservation filter parameters" } });
    }

    const reservations = await listReservationsForAccount(request.accountId!, queryResult.data);
    return reply.code(200).send({ reservations, page: queryResult.data.page, pageSize: queryResult.data.pageSize });
  });

  app.post("/api/v1/host/reservations", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createReservationRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "unitId, checkIn, checkOut, and guestName are required" },
      });
    }

    try {
      const detail = await createHostReservation(request.accountId!, bodyResult.data);
      return reply.code(201).send(detail);
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      if (err instanceof ConcurrencyError) return sendConcurrencyConflict(reply, err);
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

  app.get("/api/v1/host/tax-rules", { preHandler: hostPreHandler }, async (request, reply) => {
    const taxRules = await listTaxRulesForAccount(request.accountId!);
    return reply.code(200).send({ taxRules });
  });

  app.post("/api/v1/host/tax-rules", { preHandler: hostPreHandler }, async (request, reply) => {
    const bodyResult = createTaxRuleRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: { code: "INVALID_PAYLOAD", message: "jurisdiction, taxType, rateType, and rateValue are required" },
      });
    }

    const taxRule = await createTaxRule(request.accountId!, bodyResult.data);
    return reply.code(201).send({ taxRule });
  });

  app.delete("/api/v1/host/tax-rules/:taxRuleId", { preHandler: hostPreHandler }, async (request, reply) => {
    const params = request.params as { taxRuleId: string };
    await deleteTaxRule(request.accountId!, params.taxRuleId);
    return reply.code(204).send();
  });
}
