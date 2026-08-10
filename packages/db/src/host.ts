import { and, eq, gte, lte } from "drizzle-orm";
import { TenantAccessError } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { getReservationById } from "./smart-locks";
import { blockDates, unblockDates } from "./inventory";
import { units } from "./schema/units";
import { properties } from "./schema/properties";
import { nightlyAvailability } from "./schema/nightly-availability";
import { payments } from "./schema/payments";
import { threads } from "./schema/threads";
import { guestSessions } from "./schema/guest-sessions";

const WEB_ENGINE_URL = process.env.WEB_ENGINE_URL ?? "http://localhost:3001";

export async function listUnitsForAccount(accountId: string) {
  return withTenant(accountId, async (tx) => {
    const rows = await tx
      .select({ unit: units, propertyName: properties.name })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId));

    return rows.map(({ unit, propertyName }) => ({ ...unit, propertyName }));
  });
}

// blockDates/unblockDates/ensureNightlyAvailability never checked unit ownership
// themselves — every prior caller (OTA webhook processing, direct booking) already
// resolved unitId from a trusted source. These host routes take unitId straight from
// a URL a caller controls, so without this check an authenticated tenant could target
// another tenant's unitId and silently create a nightly_availability row for it under
// their own accountId, effectively squatting on that unit/date pair.
async function assertUnitBelongsToAccount(accountId: string, unitId: string): Promise<void> {
  const [unit] = await withTenant(accountId, (tx) => tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)));
  if (!unit) {
    throw new TenantAccessError(`Unit ${unitId} does not belong to this account`);
  }
}

export async function getUnitCalendar(accountId: string, unitId: string, start: string, end: string) {
  await assertUnitBelongsToAccount(accountId, unitId);

  return withTenant(accountId, (tx) =>
    tx
      .select()
      .from(nightlyAvailability)
      .where(
        and(
          eq(nightlyAvailability.unitId, unitId),
          gte(nightlyAvailability.date, start),
          lte(nightlyAvailability.date, end),
        ),
      ),
  );
}

export async function blockUnitDates(accountId: string, unitId: string, dates: string[]): Promise<void> {
  await assertUnitBelongsToAccount(accountId, unitId);
  await blockDates({ accountId, unitId, dates });
}

export async function unblockUnitDates(accountId: string, unitId: string, dates: string[]): Promise<void> {
  await assertUnitBelongsToAccount(accountId, unitId);
  await unblockDates({ accountId, unitId, dates });
}

export interface ReservationDetail {
  reservation: NonNullable<Awaited<ReturnType<typeof getReservationById>>>;
  payment: typeof payments.$inferSelect | null;
  guestName: string | null;
  channel: string | null;
  guestPortalUrl: string | null;
}

export async function getReservationDetail(accountId: string, reservationId: string): Promise<ReservationDetail | null> {
  const reservation = await getReservationById(accountId, reservationId);
  if (!reservation) {
    return null;
  }

  return withTenant(accountId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.reservationId, reservationId));
    const [thread] = await tx.select().from(threads).where(eq(threads.reservationId, reservationId));
    // guest_sessions has no RLS (see schema/guest-sessions.ts) — reservationId here is
    // already tenant-verified by getReservationById above, so this lookup is safe as-is.
    const [session] = await tx.select().from(guestSessions).where(eq(guestSessions.reservationId, reservationId));

    return {
      reservation,
      payment: payment ?? null,
      guestName: thread?.guestName ?? null,
      channel: thread?.channel ?? null,
      guestPortalUrl: session ? `${WEB_ENGINE_URL}/guest/${session.token}` : null,
    };
  });
}
