import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  reservations,
  staffMembers,
  housekeepingTasks,
  createCheckoutCleaningTasks,
} from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("Task routes", () => {
  let account: { id: string };
  let unit: { id: string };
  let reservation: { id: string; checkOut: string };
  let cleanerStaff: { id: string };
  let otherStaff: { id: string };
  let ownerToken: string;
  let cleanerToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Task Route Test Tenant" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    const today = new Date().toISOString().slice(0, 10);
    reservation = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({ accountId: account.id, unitId: unit.id, checkIn: "2030-01-01", checkOut: today, status: "confirmed" })
        .returning();
      return row!;
    });

    cleanerStaff = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(staffMembers)
        .values({ accountId: account.id, name: "Cleaner", email: "cleaner@example.com", role: "cleaner" })
        .returning();
      return row!;
    });
    otherStaff = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(staffMembers)
        .values({ accountId: account.id, name: "Other Cleaner", email: "other-cleaner@example.com", role: "cleaner" })
        .returning();
      return row!;
    });

    ownerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    cleanerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "cleaner@example.com", role: "cleaner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(housekeepingTasks).where(eq(housekeepingTasks.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(staffMembers).where(eq(staffMembers.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.id, reservation.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("creates an idempotent cleaning task on checkout, visible to owner/manager", async () => {
    const firstRun = await createCheckoutCleaningTasks();
    expect(firstRun).toBeGreaterThanOrEqual(1);

    const secondRun = await createCheckoutCleaningTasks();
    expect(secondRun).toBe(0);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/host/tasks?unitId=${unit.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(200);
    const tasks = response.json().tasks as Array<{ reservationId: string | null; taskType: string }>;
    expect(tasks.some((t) => t.reservationId === reservation.id && t.taskType === "cleaning")).toBe(true);

    await app.close();
    // createCheckoutCleaningTasks scans every account (same pattern as
    // evaluateAutomationRules), so under the full parallel test-file run against the
    // shared dev database this comfortably exceeds the default 20s window.
  }, 45000);

  it("scopes a cleaner's task list to their own assignments and blocks task creation", async () => {
    const assignedTask = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(housekeepingTasks)
        .values({ accountId: account.id, unitId: unit.id, assignedStaffId: cleanerStaff.id, taskType: "maintenance", dueAt: new Date() })
        .returning();
      return row!;
    });
    const unassignedToOtherTask = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(housekeepingTasks)
        .values({ accountId: account.id, unitId: unit.id, assignedStaffId: otherStaff.id, taskType: "inspection", dueAt: new Date() })
        .returning();
      return row!;
    });

    const app = buildApp();

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/host/tasks", headers: { authorization: `Bearer ${cleanerToken}` } });
    expect(listResponse.statusCode).toBe(200);
    const taskIds = (listResponse.json().tasks as Array<{ id: string }>).map((t) => t.id);
    expect(taskIds).toContain(assignedTask.id);
    expect(taskIds).not.toContain(unassignedToOtherTask.id);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/host/tasks",
      headers: { authorization: `Bearer ${cleanerToken}` },
      payload: { unitId: unit.id, taskType: "cleaning", dueAt: new Date().toISOString() },
    });
    expect(createResponse.statusCode).toBe(403);
    expect(createResponse.json().error.code).toBe("FORBIDDEN");

    const patchOwnTask = await app.inject({
      method: "PATCH",
      url: `/api/v1/host/tasks/${assignedTask.id}`,
      headers: { authorization: `Bearer ${cleanerToken}` },
      payload: { status: "completed" },
    });
    expect(patchOwnTask.statusCode).toBe(200);

    const patchOthersTask = await app.inject({
      method: "PATCH",
      url: `/api/v1/host/tasks/${unassignedToOtherTask.id}`,
      headers: { authorization: `Bearer ${cleanerToken}` },
      payload: { status: "completed" },
    });
    expect(patchOthersTask.statusCode).toBe(403);
    expect(patchOthersTask.json().error.code).toBe("TENANT_ACCESS_DENIED");

    await app.close();
  }, 20000);

  it("blocks a cleaner from the financial owners routes", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/host/owners", headers: { authorization: `Bearer ${cleanerToken}` } });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  }, 20000);
});
