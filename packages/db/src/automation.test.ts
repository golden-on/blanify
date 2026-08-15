import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { addDays } from "./inventory";
import { renderTemplate, evaluateAutomationRules } from "./automation";
import { accounts } from "./schema/accounts";
import { properties } from "./schema/properties";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { threads } from "./schema/threads";
import { messages } from "./schema/messages";
import { automationRules } from "./schema/automation-rules";
import { automationDispatches } from "./schema/automation-dispatches";
import { housekeepingTasks } from "./schema/housekeeping-tasks";

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    expect(renderTemplate("Hi {{guest_name}}, check-in is {{check_in_date}}.", {
      guest_name: "Jane Doe",
      check_in_date: "2028-01-01",
    })).toBe("Hi Jane Doe, check-in is 2028-01-01.");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(renderTemplate("Hello {{unknown_var}}", { guest_name: "Jane" })).toBe("Hello {{unknown_var}}");
  });
});

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("evaluateAutomationRules", () => {
  const today = new Date().toISOString().slice(0, 10);

  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };
  let dueReservation: { id: string };
  let dueThread: { id: string };
  let notYetDueReservation: { id: string };
  let notYetDueThread: { id: string };
  let checkedOutReservation: { id: string };
  let checkedOutThread: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Automation Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "Automation Test Property" })
        .returning();
      return row!;
    });

    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Unit 1" })
        .returning();
      return row!;
    });

    // check_in_reminder, offsetDays=3: fires when today >= checkIn - 3.
    await withTenant(account.id, (tx) =>
      tx.insert(automationRules).values({
        accountId: account.id,
        trigger: "check_in_reminder",
        offsetDays: 3,
        template: "Hi {{guest_name}}, your check-in on {{check_in_date}} is coming up!",
        isActive: true,
      }),
    );

    // check_out_thanks, offsetDays=1: fires when today >= checkOut + 1.
    await withTenant(account.id, (tx) =>
      tx.insert(automationRules).values({
        accountId: account.id,
        trigger: "check_out_thanks",
        offsetDays: 1,
        template: "Thanks for staying, {{guest_name}}! Hope you enjoyed {{check_out_date}}.",
        isActive: true,
      }),
    );

    // Due today: checkIn = today + 3.
    dueReservation = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({
          accountId: account.id,
          unitId: unit.id,
          checkIn: addDays(today, 3),
          checkOut: addDays(today, 5),
          status: "confirmed",
        })
        .returning();
      return row!;
    });
    dueThread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(threads)
        .values({
          accountId: account.id,
          unitId: unit.id,
          reservationId: dueReservation.id,
          guestName: "Jane Due",
          channel: "airbnb",
        })
        .returning();
      return row!;
    });

    // Not due yet: checkIn = today + 10.
    notYetDueReservation = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({
          accountId: account.id,
          unitId: unit.id,
          checkIn: addDays(today, 10),
          checkOut: addDays(today, 12),
          status: "confirmed",
        })
        .returning();
      return row!;
    });
    notYetDueThread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(threads)
        .values({
          accountId: account.id,
          unitId: unit.id,
          reservationId: notYetDueReservation.id,
          guestName: "Nora NotYet",
          channel: "airbnb",
        })
        .returning();
      return row!;
    });

    // Checked out yesterday -> check_out_thanks (offset 1) is due today.
    checkedOutReservation = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({
          accountId: account.id,
          unitId: unit.id,
          checkIn: addDays(today, -3),
          checkOut: addDays(today, -1),
          status: "confirmed",
        })
        .returning();
      return row!;
    });
    checkedOutThread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(threads)
        .values({
          accountId: account.id,
          unitId: unit.id,
          reservationId: checkedOutReservation.id,
          guestName: "Carl Checkedout",
          channel: "direct",
        })
        .returning();
      return row!;
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(automationDispatches).where(eq(automationDispatches.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(messages).where(eq(messages.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(housekeepingTasks).where(eq(housekeepingTasks.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(automationRules).where(eq(automationRules.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("fires check_in_reminder and check_out_thanks for reservations whose offset date has arrived, skips one that isn't due yet", async () => {
    // A single evaluation pass considers every active rule against every candidate
    // reservation at once, so both trigger types are asserted from one call here.
    const results = await evaluateAutomationRules();

    const dueDispatch = results.find((r) => r.threadId === dueThread.id);
    expect(dueDispatch).toBeTruthy();
    expect(dueDispatch?.message.content).toContain("Jane Due");
    expect(dueDispatch?.message.content).toContain(addDays(today, 3));
    expect(dueDispatch?.message.senderType ?? "system").toBe("system");

    const notYetDueDispatch = results.find((r) => r.threadId === notYetDueThread.id);
    expect(notYetDueDispatch).toBeUndefined();

    const checkedOutDispatch = results.find((r) => r.threadId === checkedOutThread.id);
    expect(checkedOutDispatch).toBeTruthy();
    expect(checkedOutDispatch?.message.content).toContain("Carl Checkedout");
    expect(checkedOutDispatch?.message.content).toContain(addDays(today, -1));
  }, 30000);

  it("does not dispatch the same rule twice for the same reservation", async () => {
    const before = await withTenant(account.id, (tx) =>
      tx.select().from(messages).where(eq(messages.threadId, dueThread.id)),
    );

    const results = await evaluateAutomationRules();
    const duplicateDispatch = results.find((r) => r.threadId === dueThread.id);
    expect(duplicateDispatch).toBeUndefined();

    const after = await withTenant(account.id, (tx) =>
      tx.select().from(messages).where(eq(messages.threadId, dueThread.id)),
    );
    expect(after).toHaveLength(before.length);
  }, 30000);
});
