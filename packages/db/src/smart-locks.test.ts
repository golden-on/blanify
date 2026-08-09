import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { computeAccessWindow, recordAccessCode } from "./smart-locks";
import { accounts } from "./schema/accounts";
import { properties } from "./schema/properties";
import { units } from "./schema/units";
import { reservations } from "./schema/reservations";
import { smartLocks } from "./schema/smart-locks";
import { accessCodes } from "./schema/access-codes";
import { threads } from "./schema/threads";
import { messages } from "./schema/messages";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("recordAccessCode", () => {
  let account: { id: string };
  let unit: { id: string };
  let reservationWithThread: { id: string; checkIn: string; checkOut: string };
  let reservationWithoutThread: { id: string; checkIn: string; checkOut: string };
  let lockForThreadReservation: { id: string };
  let lockForThreadlessReservation: { id: string };
  let thread: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Smart Lock Test Tenant" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Unit" })
        .returning();
      return row!;
    });

    reservationWithThread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({ accountId: account.id, unitId: unit.id, checkIn: "2027-06-01", checkOut: "2027-06-05" })
        .returning();
      return row!;
    });
    reservationWithoutThread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({ accountId: account.id, unitId: unit.id, checkIn: "2027-07-01", checkOut: "2027-07-03" })
        .returning();
      return row!;
    });

    lockForThreadReservation = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(smartLocks)
        .values({
          accountId: account.id,
          unitId: unit.id,
          provider: "seam",
          externalDeviceId: "device_with_thread",
          deviceName: "Front Door",
        })
        .returning();
      return row!;
    });
    lockForThreadlessReservation = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(smartLocks)
        .values({
          accountId: account.id,
          unitId: unit.id,
          provider: "seam",
          externalDeviceId: "device_without_thread",
          deviceName: "Side Door",
        })
        .returning();
      return row!;
    });

    thread = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(threads)
        .values({
          accountId: account.id,
          unitId: unit.id,
          reservationId: reservationWithThread.id,
          guestName: "Access Code Guest",
          channel: "direct",
        })
        .returning();
      return row!;
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(messages).where(eq(messages.threadId, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(accessCodes).where(eq(accessCodes.reservationId, reservationWithThread.id)));
    await withTenant(account.id, (tx) => tx.delete(accessCodes).where(eq(accessCodes.reservationId, reservationWithoutThread.id)));
    await withTenant(account.id, (tx) => tx.delete(threads).where(eq(threads.id, thread.id)));
    await withTenant(account.id, (tx) => tx.delete(smartLocks).where(eq(smartLocks.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("persists a time-bound access code matching computeAccessWindow, posts a system message when a thread exists, and is idempotent on retry", async () => {
    const window = computeAccessWindow(reservationWithThread.checkIn, reservationWithThread.checkOut);

    const first = await recordAccessCode({
      accountId: account.id,
      reservationId: reservationWithThread.id,
      smartLockId: lockForThreadReservation.id,
      code: "482913",
      externalAccessCodeId: "seam_ac_test_1",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    expect(first).not.toBeNull();
    expect(first!.accessCode.startsAt.getTime()).toBe(window.startsAt.getTime());
    expect(first!.accessCode.endsAt.getTime()).toBe(window.endsAt.getTime());
    expect(first!.accessCode.status).toBe("active");
    expect(first!.dispatch).not.toBeNull();
    expect(first!.dispatch!.message.content).toContain("482913");

    const [updatedThread] = await withTenant(account.id, (tx) => tx.select().from(threads).where(eq(threads.id, thread.id)));
    expect(updatedThread!.lastMessageAt.getTime()).toBeGreaterThan(0);

    const retry = await recordAccessCode({
      accountId: account.id,
      reservationId: reservationWithThread.id,
      smartLockId: lockForThreadReservation.id,
      code: "999999",
      externalAccessCodeId: "seam_ac_test_1_retry",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    expect(retry).toBeNull();

    const rows = await withTenant(account.id, (tx) =>
      tx.select().from(accessCodes).where(eq(accessCodes.reservationId, reservationWithThread.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe("482913");
  }, 20000);

  it("returns a null dispatch and creates no message when the reservation has no thread", async () => {
    const window = computeAccessWindow(reservationWithoutThread.checkIn, reservationWithoutThread.checkOut);

    const result = await recordAccessCode({
      accountId: account.id,
      reservationId: reservationWithoutThread.id,
      smartLockId: lockForThreadlessReservation.id,
      code: "111222",
      externalAccessCodeId: "seam_ac_test_2",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    expect(result).not.toBeNull();
    expect(result!.dispatch).toBeNull();
  }, 20000);
});
