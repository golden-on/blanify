import { z } from "zod";
import { idSchema } from "./base";
import { userRoleSchema } from "./auth";

const dateTimeStringSchema = z.string().min(1);
const taskTypeSchema = z.enum(["cleaning", "maintenance", "inspection"]);
const taskStatusSchema = z.enum(["pending", "in_progress", "completed", "verified"]);

export const createStaffMemberRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema,
  isActive: z.boolean().optional(),
});

export const createTaskRequestSchema = z.object({
  unitId: idSchema,
  reservationId: idSchema.optional(),
  assignedStaffId: idSchema.optional(),
  taskType: taskTypeSchema,
  dueAt: dateTimeStringSchema,
});

export const updateTaskRequestSchema = z
  .object({
    status: taskStatusSchema,
    assignedStaffId: idSchema,
    photoUrls: z.array(z.string().min(1)),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field must be provided" });

export type CreateStaffMemberRequest = z.infer<typeof createStaffMemberRequestSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
