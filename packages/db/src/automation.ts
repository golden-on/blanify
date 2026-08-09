import { eq } from "drizzle-orm";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { addDays } from "./inventory";
import { accounts } from "./schema/accounts";
import { automationRules } from "./schema/automation-rules";
import { automationDispatches } from "./schema/automation-dispatches";
import { reservations } from "./schema/reservations";
import { threads } from "./schema/threads";
import { messages } from "./schema/messages";

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

function computeTargetDate(
  rule: typeof automationRules.$inferSelect,
  reservation: typeof reservations.$inferSelect,
): string {
  switch (rule.trigger) {
    case "booking_confirmed":
      return addDays(reservation.createdAt.toISOString().slice(0, 10), rule.offsetDays);
    case "check_in_reminder":
      return addDays(reservation.checkIn, -rule.offsetDays);
    case "check_out_thanks":
      return addDays(reservation.checkOut, rule.offsetDays);
  }
}

export interface AutomationDispatchResult {
  accountId: string;
  threadId: string;
  message: typeof messages.$inferSelect;
}

export async function evaluateAutomationRules(): Promise<AutomationDispatchResult[]> {
  const allAccounts = await db.select().from(accounts);
  const today = new Date().toISOString().slice(0, 10);
  const results: AutomationDispatchResult[] = [];

  for (const account of allAccounts) {
    await withTenant(account.id, async (tx) => {
      const activeRules = await tx.select().from(automationRules).where(eq(automationRules.isActive, true));
      if (activeRules.length === 0) return;

      const candidates = await tx
        .select({ reservation: reservations, thread: threads })
        .from(reservations)
        .innerJoin(threads, eq(threads.reservationId, reservations.id))
        .where(eq(reservations.status, "confirmed"));
      if (candidates.length === 0) return;

      for (const rule of activeRules) {
        for (const { reservation, thread } of candidates) {
          const targetDate = computeTargetDate(rule, reservation);
          if (targetDate > today) continue;
          // A check-in reminder is only meaningful before check-in actually happens —
          // without this, the "today >= checkIn - offsetDays" condition stays true
          // forever afterward and would fire for reservations long past check-in.
          if (rule.trigger === "check_in_reminder" && today > reservation.checkIn) continue;

          const [dispatch] = await tx
            .insert(automationDispatches)
            .values({
              accountId: account.id,
              reservationId: reservation.id,
              automationRuleId: rule.id,
              threadId: thread.id,
            })
            .onConflictDoNothing({
              target: [automationDispatches.reservationId, automationDispatches.automationRuleId],
            })
            .returning();

          if (!dispatch) {
            // Already dispatched on a previous tick.
            continue;
          }

          const content = renderTemplate(rule.template, {
            guest_name: thread.guestName,
            check_in_date: reservation.checkIn,
            check_out_date: reservation.checkOut,
          });

          const [message] = await tx
            .insert(messages)
            .values({ accountId: account.id, threadId: thread.id, senderType: "system", content, isRead: true })
            .returning();
          if (!message) {
            continue;
          }

          await tx
            .update(threads)
            .set({ lastMessageAt: new Date(), updatedAt: new Date() })
            .where(eq(threads.id, thread.id));

          results.push({ accountId: account.id, threadId: thread.id, message });
        }
      }
    });
  }

  return results;
}
