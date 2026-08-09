import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { TenantAccessError, createStaffMemberRequestSchema, createTaskRequestSchema, updateTaskRequestSchema } from "@repo/shared-types";
import { createStaffMember, createTask, listStaffForAccount, listTasksForAccount, updateTask } from "@repo/db";
import { requireAuth, requireRole } from "../auth";

const taskFiltersQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  status: z.enum(["pending", "in_progress", "completed", "verified"]).optional(),
});

function sendTenantAccessDenied(reply: FastifyReply, err: TenantAccessError) {
  return reply.code(403).send({ error: { code: err.code, message: err.message } });
}

const anyStaffPreHandler = [requireAuth, requireRole("owner", "manager", "cleaner", "maintenance")];
const managerPreHandler = [requireAuth, requireRole("owner", "manager")];

export async function registerTaskRoutes(app: FastifyInstance) {
  app.get("/api/v1/host/tasks", { preHandler: anyStaffPreHandler }, async (request, reply) => {
    const queryResult = taskFiltersQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Invalid unitId or status filter" } });
    }

    const tasks = await listTasksForAccount(
      request.accountId!,
      { role: request.userRole!, email: request.userEmail! },
      queryResult.data,
    );
    return reply.code(200).send({ tasks });
  });

  app.post("/api/v1/host/tasks", { preHandler: managerPreHandler }, async (request, reply) => {
    const bodyResult = createTaskRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "unitId, taskType, and dueAt are required" } });
    }

    try {
      const task = await createTask(request.accountId!, bodyResult.data);
      return reply.code(201).send({ task });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.patch("/api/v1/host/tasks/:taskId", { preHandler: anyStaffPreHandler }, async (request, reply) => {
    const params = request.params as { taskId: string };
    const bodyResult = updateTaskRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "At least one of status, assignedStaffId, photoUrls is required" } });
    }

    try {
      const task = await updateTask(request.accountId!, params.taskId, bodyResult.data, {
        role: request.userRole!,
        email: request.userEmail!,
      });
      return reply.code(200).send({ task });
    } catch (err) {
      if (err instanceof TenantAccessError) return sendTenantAccessDenied(reply, err);
      throw err;
    }
  });

  app.get("/api/v1/host/staff", { preHandler: managerPreHandler }, async (request, reply) => {
    const staff = await listStaffForAccount(request.accountId!);
    return reply.code(200).send({ staff });
  });

  app.post("/api/v1/host/staff", { preHandler: managerPreHandler }, async (request, reply) => {
    const bodyResult = createStaffMemberRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "name, email, and role are required" } });
    }

    const staffMember = await createStaffMember(request.accountId!, bodyResult.data);
    return reply.code(201).send({ staffMember });
  });
}
