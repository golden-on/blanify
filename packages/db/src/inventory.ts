import { and, eq, inArray, sql } from "drizzle-orm";
import { ConcurrencyError, type ReservationChannel } from "@repo/shared-types";
import type { Transaction } from "./tenant-context";
import { withTenant } from "./tenant-context";
import { nightlyAvailability } from "./schema/nightly-availability";
import { reservations } from "./schema/reservations";
import { threads } from "./schema/threads";

const LOCK_NOT_AVAILABLE = "55P03";

export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  let current = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);

  while (current < end) {
    dates.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  return dates;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function ensureNightlyAvailability(
  accountId: string,
  unitId: string,
  dates: string[],
  priceInCents?: number,
): Promise<void> {
  if (dates.length === 0) return;

  await withTenant(accountId, async (tx) => {
    await tx
      .insert(nightlyAvailability)
      .values(
        dates.map((date) => ({
          accountId,
          unitId,
          date,
          status: "available" as const,
          priceInCents,
        })),
      )
      .onConflictDoNothing({
        target: [nightlyAvailability.unitId, nightlyAvailability.date],
      });
  });
}

interface LockedNight {
  [column: string]: unknown;
  id: string;
  date: string;
  status: string;
}

export async function lockNightlyAvailabilityRows(
  tx: Transaction,
  unitId: string,
  dates: string[],
): Promise<LockedNight[]> {
  // Drizzle's `.for('update', { noWait: true })` emits invalid SQL ("NO WAIT" as two
  // words) on this version, so the lock clause is built as raw SQL instead. Dates are
  // bound individually via sql.join (not a single array parameter) to avoid postgres.js
  // sending them as an untyped array, which `date = ANY(...)` rejects.
  const dateList = sql.join(
    dates.map((date) => sql`${date}`),
    sql`, `,
  );

  try {
    const rows = await tx.execute<LockedNight>(
      sql`select id, date, status from nightly_availability where unit_id = ${unitId} and date in (${dateList}) for update nowait`,
    );
    return Array.from(rows);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === LOCK_NOT_AVAILABLE) {
      throw new ConcurrencyError("Requested nights are currently locked by another operation");
    }
    throw err;
  }
}

export interface CreateReservationInput {
  accountId: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  // When set, also creates a `threads` row so the calendar/detail views have a
  // guest name and channel to show — only the host-created manual-booking path
  // sets these today; webhook-sourced reservations omit them (see Phase 12 plan
  // Decision 1: nothing else in the codebase creates threads yet).
  guestName?: string;
  guestEmail?: string;
  channel?: ReservationChannel;
  // Distributed evenly across `dates` (remainder cents on the last night) and
  // written to each night's priceInCents, overriding whatever rate was set
  // before. Omit to leave each night's existing priceInCents untouched.
  totalPriceInCents?: number;
}

export async function createReservation(input: CreateReservationInput) {
  const dates = nightsBetween(input.checkIn, input.checkOut);
  if (dates.length === 0) {
    throw new Error("checkOut must be after checkIn");
  }

  await ensureNightlyAvailability(input.accountId, input.unitId, dates);

  return withTenant(input.accountId, async (tx) => {
    const lockedRows = await lockNightlyAvailabilityRows(tx, input.unitId, dates);

    if (lockedRows.length !== dates.length || lockedRows.some((row) => row.status !== "available")) {
      throw new ConcurrencyError("One or more requested nights are no longer available");
    }

    const [reservation] = await tx
      .insert(reservations)
      .values({
        accountId: input.accountId,
        unitId: input.unitId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
      })
      .returning();

    if (!reservation) {
      throw new Error("Failed to create reservation");
    }

    if (input.totalPriceInCents !== undefined) {
      const baseInCents = Math.floor(input.totalPriceInCents / dates.length);
      const remainderInCents = input.totalPriceInCents - baseInCents * dates.length;

      for (let i = 0; i < dates.length; i++) {
        const priceInCents = baseInCents + (i === dates.length - 1 ? remainderInCents : 0);
        await tx
          .update(nightlyAvailability)
          .set({ status: "booked", reservationId: reservation.id, priceInCents, updatedAt: new Date() })
          .where(and(eq(nightlyAvailability.unitId, input.unitId), eq(nightlyAvailability.date, dates[i]!)));
      }
    } else {
      await tx
        .update(nightlyAvailability)
        .set({ status: "booked", reservationId: reservation.id, updatedAt: new Date() })
        .where(and(eq(nightlyAvailability.unitId, input.unitId), inArray(nightlyAvailability.date, dates)));
    }

    if (input.guestName) {
      await tx.insert(threads).values({
        accountId: input.accountId,
        unitId: input.unitId,
        reservationId: reservation.id,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        channel: input.channel ?? "direct",
      });
    }

    return reservation;
  });
}

export interface BlockDatesInput {
  accountId: string;
  unitId: string;
  dates: string[];
  reason?: string;
}

export async function blockDates(input: BlockDatesInput): Promise<void> {
  if (input.dates.length === 0) return;

  await ensureNightlyAvailability(input.accountId, input.unitId, input.dates);

  await withTenant(input.accountId, async (tx) => {
    const lockedRows = await lockNightlyAvailabilityRows(tx, input.unitId, input.dates);

    // Re-blocking an already-blocked night is a no-op (feeds re-sync every 5-15 minutes),
    // only an existing 'booked' night is a genuine conflict.
    if (
      lockedRows.length !== input.dates.length ||
      lockedRows.some((row) => row.status === "booked")
    ) {
      throw new ConcurrencyError("One or more requested nights are not available to block");
    }

    await tx
      .update(nightlyAvailability)
      .set({ status: "blocked", blockReason: input.reason ?? null, updatedAt: new Date() })
      .where(
        and(eq(nightlyAvailability.unitId, input.unitId), inArray(nightlyAvailability.date, input.dates)),
      );
  });
}

export interface UnblockDatesInput {
  accountId: string;
  unitId: string;
  dates: string[];
}

export async function unblockDates(input: UnblockDatesInput): Promise<void> {
  if (input.dates.length === 0) return;

  await withTenant(input.accountId, async (tx) => {
    await tx
      .update(nightlyAvailability)
      .set({ status: "available", blockReason: null, updatedAt: new Date() })
      .where(
        and(
          eq(nightlyAvailability.unitId, input.unitId),
          inArray(nightlyAvailability.date, input.dates),
          eq(nightlyAvailability.status, "blocked"),
        ),
      );
  });
}
