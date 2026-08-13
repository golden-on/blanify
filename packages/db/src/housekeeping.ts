import { and, eq, gte, lte } from "drizzle-orm";
import { TenantAccessError } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { addDays } from "./inventory";
import { db } from "./client";
import { accounts } from "./schema/accounts";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { staffMembers } from "./schema/staff-members";
import { housekeepingTasks } from "./schema/housekeeping-tasks";

export type StaffRole = (typeof staffMembers.$inferSelect)["role"];

export interface CreateStaffMemberInput {
  name: string;
  email: string;
  role: StaffRole;
  isActive?: boolean;
}

export async function createStaffMember(accountId: string, input: CreateStaffMemberInput) {
  return withTenant(accountId, async (tx) => {
    const [staffMember] = await tx
      .insert(staffMembers)
      .values({ accountId, name: input.name, email: input.email, role: input.role, isActive: input.isActive })
      .returning();

    if (!staffMember) {
      throw new Error("Failed to create staff member");
    }

    return staffMember;
  });
}

export async function listStaffForAccount(accountId: string) {
  return withTenant(accountId, (tx) => tx.select().from(staffMembers).where(eq(staffMembers.isActive, true)));
}

// A task's unitId comes straight from a request body a caller controls, so without
// this check an authenticated tenant could target another tenant's unitId — same
// bind as host.ts's assertUnitBelongsToAccount.
async function assertUnitBelongsToAccount(accountId: string, unitId: string): Promise<void> {
  const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
  if (!unit) {
    throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
  }
}

// Cleaner/maintenance logins have no dedicated userId column on staff_members (see
// plan decision 3) — their identity is resolved by matching the JWT's email against
// staff_members.email within the same account.
async function findStaffMemberByEmail(accountId: string, email: string) {
  const [staffMember] = await withTenant(accountId, (tx) => tx.select().from(staffMembers).where(eq(staffMembers.email, email)));
  return staffMember;
}

export interface TaskCaller {
  role: StaffRole;
  email: string;
}

const FIELD_STAFF_ROLES = new Set<StaffRole>(["cleaner", "maintenance"]);

export interface ListTasksFilters {
  unitId?: string;
  status?: (typeof housekeepingTasks.$inferSelect)["status"];
}

export async function listTasksForAccount(accountId: string, caller: TaskCaller, filters: ListTasksFilters = {}) {
  return withTenant(accountId, async (tx) => {
    const conditions = [];
    if (filters.unitId) conditions.push(eq(housekeepingTasks.unitId, filters.unitId));
    if (filters.status) conditions.push(eq(housekeepingTasks.status, filters.status));

    if (FIELD_STAFF_ROLES.has(caller.role)) {
      const staffMember = await findStaffMemberByEmail(accountId, caller.email);
      if (!staffMember) {
        return [];
      }
      conditions.push(eq(housekeepingTasks.assignedStaffId, staffMember.id));
    }

    const rows = await tx
      .select({ task: housekeepingTasks, unitName: units.name, staffName: staffMembers.name })
      .from(housekeepingTasks)
      .innerJoin(units, eq(units.id, housekeepingTasks.unitId))
      .leftJoin(staffMembers, eq(staffMembers.id, housekeepingTasks.assignedStaffId))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return rows.map(({ task, unitName, staffName }) => ({ ...task, unitName, staffName }));
  });
}

export async function getCleaningTaskForReservation(accountId: string, reservationId: string) {
  const [task] = await withTenant(accountId, (tx) =>
    tx
      .select()
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.reservationId, reservationId), eq(housekeepingTasks.taskType, "cleaning"))),
  );
  return task ?? null;
}

export interface CreateTaskInput {
  unitId: string;
  reservationId?: string;
  assignedStaffId?: string;
  taskType: (typeof housekeepingTasks.$inferSelect)["taskType"];
  dueAt: string;
}

export async function createTask(accountId: string, input: CreateTaskInput) {
  await assertUnitBelongsToAccount(accountId, input.unitId);

  return withTenant(accountId, async (tx) => {
    const [task] = await tx
      .insert(housekeepingTasks)
      .values({
        accountId,
        unitId: input.unitId,
        reservationId: input.reservationId,
        assignedStaffId: input.assignedStaffId,
        taskType: input.taskType,
        dueAt: new Date(input.dueAt),
      })
      .returning();

    if (!task) {
      throw new Error("Failed to create task");
    }

    return task;
  });
}

export interface UpdateTaskPatch {
  status?: (typeof housekeepingTasks.$inferSelect)["status"];
  assignedStaffId?: string;
  photoUrls?: string[];
}

export async function updateTask(accountId: string, taskId: string, patch: UpdateTaskPatch, caller: TaskCaller) {
  return withTenant(accountId, async (tx) => {
    const [task] = await tx.select().from(housekeepingTasks).where(eq(housekeepingTasks.id, taskId));
    if (!task) {
      throw new TenantAccessError(`Task ${taskId} does not belong to this account`);
    }

    if (FIELD_STAFF_ROLES.has(caller.role)) {
      const staffMember = await findStaffMemberByEmail(accountId, caller.email);
      if (!staffMember || task.assignedStaffId !== staffMember.id) {
        throw new TenantAccessError("You may only update tasks assigned to you");
      }
    }

    const [updated] = await tx
      .update(housekeepingTasks)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.assignedStaffId ? { assignedStaffId: patch.assignedStaffId } : {}),
        ...(patch.photoUrls ? { photoUrls: patch.photoUrls } : {}),
        ...(patch.status === "completed" ? { completedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(housekeepingTasks.id, taskId))
      .returning();

    if (!updated) {
      throw new Error("Failed to update task");
    }

    return updated;
  });
}

const CHECKOUT_TASK_LOOKBACK_DAYS = 3;

// Called from the same hourly job as evaluateAutomationRules (see
// packages/queue/src/workers/inbox-automation.ts). Unlike that messaging-focused
// evaluator, this doesn't touch automation_rules/automation_dispatches — a
// housekeeping task isn't a guest message, so it gets its own idempotency via the
// housekeeping_tasks_reservation_type_unique constraint instead. Bounded to the last
// few days so a first-time deploy doesn't backfill a cleaning task for every
// reservation that ever checked out.
export async function createCheckoutCleaningTasks(): Promise<number> {
  const allAccounts = await db.select().from(accounts);
  const today = new Date().toISOString().slice(0, 10);
  const earliestCheckOut = addDays(today, -CHECKOUT_TASK_LOOKBACK_DAYS);
  let created = 0;

  for (const account of allAccounts) {
    await withTenant(account.id, async (tx) => {
      const candidates = await tx
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.status, "confirmed"),
            gte(reservations.checkOut, earliestCheckOut),
            lte(reservations.checkOut, today),
          ),
        );

      for (const reservation of candidates) {
        const [task] = await tx
          .insert(housekeepingTasks)
          .values({
            accountId: account.id,
            unitId: reservation.unitId,
            reservationId: reservation.id,
            taskType: "cleaning",
            dueAt: new Date(`${reservation.checkOut}T11:00:00Z`),
          })
          .onConflictDoNothing({ target: [housekeepingTasks.reservationId, housekeepingTasks.taskType] })
          .returning();

        if (task) {
          created += 1;
        }
      }
    });
  }

  return created;
}
