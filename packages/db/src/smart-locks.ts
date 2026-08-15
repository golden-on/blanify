import { and, eq } from "drizzle-orm";
import { withTenant } from "./tenant-context";
import { smartLocks } from "./schema/smart-locks";
import { accessCodes } from "./schema/access-codes";
import { reservations } from "./schema/reservations";
import { threads } from "./schema/threads";
import { messages } from "./schema/messages";
import { units } from "./schema/units";

export async function getSmartLockForUnit(accountId: string, unitId: string) {
  return withTenant(accountId, async (tx) => {
    const [row] = await tx.select().from(smartLocks).where(eq(smartLocks.unitId, unitId));
    return row;
  });
}

export async function listSmartLocksForAccount(accountId: string) {
  return withTenant(accountId, async (tx) => {
    const rows = await tx
      .select({ lock: smartLocks, unitName: units.name })
      .from(smartLocks)
      .innerJoin(units, eq(units.id, smartLocks.unitId));

    return rows.map(({ lock, unitName }) => ({ ...lock, unitName }));
  });
}

export async function getReservationById(accountId: string, reservationId: string) {
  return withTenant(accountId, async (tx) => {
    const [row] = await tx.select().from(reservations).where(eq(reservations.id, reservationId));
    return row;
  });
}

export interface AccessWindow {
  startsAt: Date;
  endsAt: Date;
}

// Reservations only store dates, not times, so a standard 3pm check-in / 11am
// check-out convention is the documented default access window for a guest's PIN.
export function computeAccessWindow(checkIn: string, checkOut: string): AccessWindow {
  return {
    startsAt: new Date(`${checkIn}T15:00:00Z`),
    endsAt: new Date(`${checkOut}T11:00:00Z`),
  };
}

// Guest-portal read: returns the active PIN for this reservation's unit lock, or
// null if there's no lock on the unit or no active (non-revoked/non-expired) code
// has been provisioned yet.
export async function getActiveAccessCodeForReservation(accountId: string, unitId: string, reservationId: string) {
  return withTenant(accountId, async (tx) => {
    const [lock] = await tx.select().from(smartLocks).where(eq(smartLocks.unitId, unitId));
    if (!lock) {
      return null;
    }

    const [code] = await tx
      .select()
      .from(accessCodes)
      .where(
        and(eq(accessCodes.reservationId, reservationId), eq(accessCodes.smartLockId, lock.id), eq(accessCodes.status, "active")),
      );

    return code ?? null;
  });
}

export interface RecordAccessCodeInput {
  accountId: string;
  reservationId: string;
  smartLockId: string;
  code: string;
  externalAccessCodeId: string | null;
  startsAt: Date;
  endsAt: Date;
}

export interface AccessCodeDispatchResult {
  threadId: string;
  message: typeof messages.$inferSelect;
}

export interface RecordAccessCodeResult {
  accessCode: typeof accessCodes.$inferSelect;
  dispatch: AccessCodeDispatchResult | null;
}

export async function recordAccessCode(input: RecordAccessCodeInput): Promise<RecordAccessCodeResult | null> {
  return withTenant(input.accountId, async (tx) => {
    const [accessCode] = await tx
      .insert(accessCodes)
      .values({
        accountId: input.accountId,
        reservationId: input.reservationId,
        smartLockId: input.smartLockId,
        code: input.code,
        externalAccessCodeId: input.externalAccessCodeId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      })
      .onConflictDoNothing({
        target: [accessCodes.reservationId, accessCodes.smartLockId],
      })
      .returning();

    if (!accessCode) {
      // Already provisioned on a previous job attempt — a retry no-op.
      return null;
    }

    const [thread] = await tx.select().from(threads).where(eq(threads.reservationId, input.reservationId));
    if (!thread) {
      // No inbound guest thread exists for this reservation yet — same limitation as
      // automation dispatch (reservations carry no guest identity to create one from).
      return { accessCode, dispatch: null };
    }

    const content = `Your access code for check-in is ${input.code}. It is valid from ${input.startsAt.toISOString()} to ${input.endsAt.toISOString()}.`;

    const [message] = await tx
      .insert(messages)
      .values({ accountId: input.accountId, threadId: thread.id, senderType: "system", content, isRead: true })
      .returning();

    if (!message) {
      return { accessCode, dispatch: null };
    }

    await tx
      .update(threads)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(threads.id, thread.id));

    return { accessCode, dispatch: { threadId: thread.id, message } };
  });
}
