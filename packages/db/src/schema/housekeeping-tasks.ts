import { sql } from "drizzle-orm";
import { jsonb, pgEnum, pgPolicy, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { units } from "./units";
import { reservations } from "./reservations";
import { staffMembers } from "./staff-members";

export const taskType = pgEnum("task_type", ["cleaning", "maintenance", "inspection"]);
export const taskStatus = pgEnum("task_status", ["pending", "in_progress", "completed", "verified"]);

export const housekeepingTasks = pgTable(
  "housekeeping_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    assignedStaffId: uuid("assigned_staff_id").references(() => staffMembers.id),
    taskType: taskType("task_type").notNull(),
    status: taskStatus("status").notNull().default("pending"),
    dueAt: timestamp("due_at").notNull(),
    completedAt: timestamp("completed_at"),
    photoUrls: jsonb("photo_urls").notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Backs the idempotent checkout-triggered cleaning task: Postgres unique
    // constraints treat NULLs as distinct, so manual tasks (reservationId null)
    // are never constrained by this — only one row per (reservation, type) exists.
    unique("housekeeping_tasks_reservation_type_unique").on(table.reservationId, table.taskType),
    pgPolicy("tenant_isolation_policy", {
      for: "all",
      to: "public",
      using: sql`${table.accountId}::text = current_setting('app.current_tenant_id', true)`,
    }),
  ],
).enableRLS();
