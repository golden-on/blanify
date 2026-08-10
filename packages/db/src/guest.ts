import { eq } from "drizzle-orm";
import { db } from "./client";
import { withTenant } from "./tenant-context";
import { getActiveAccessCodeForReservation, getReservationById } from "./smart-locks";
import { guestSessions } from "./schema/guest-sessions";
import { units } from "./schema/units";
import { properties } from "./schema/properties";

// No withTenant here — see schema/guest-sessions.ts: a guest only has the token, no
// accountId, so this lookup has to be unscoped. Everything after this resolves the
// tenant from the returned row and runs fully tenant-scoped.
export async function getGuestSessionByToken(token: string) {
  const [session] = await db.select().from(guestSessions).where(eq(guestSessions.token, token));
  return session;
}

export interface GuestPortalData {
  reservation: { checkIn: string; checkOut: string; status: string };
  unit: { name: string; checkInInstructions: string | null } | null;
  property: { name: string; address: string | null } | null;
  lockCode: { code: string; startsAt: Date; endsAt: Date } | null;
  checkInCompletedAt: Date | null;
  signedAgreementUrl: string | null;
}

export async function getGuestPortalData(token: string): Promise<GuestPortalData | null> {
  const session = await getGuestSessionByToken(token);
  if (!session) {
    return null;
  }

  const reservation = await getReservationById(session.accountId, session.reservationId);
  if (!reservation) {
    return null;
  }

  const { unit, property } = await withTenant(session.accountId, async (tx) => {
    const [unitRow] = await tx.select().from(units).where(eq(units.id, reservation.unitId));
    const [propertyRow] = unitRow ? await tx.select().from(properties).where(eq(properties.id, unitRow.propertyId)) : [undefined];
    return { unit: unitRow, property: propertyRow };
  });

  const lockCode = await getActiveAccessCodeForReservation(session.accountId, reservation.unitId, reservation.id);

  return {
    reservation: { checkIn: reservation.checkIn, checkOut: reservation.checkOut, status: reservation.status },
    unit: unit ? { name: unit.name, checkInInstructions: unit.checkInInstructions } : null,
    property: property ? { name: property.name, address: property.address } : null,
    lockCode: lockCode ? { code: lockCode.code, startsAt: lockCode.startsAt, endsAt: lockCode.endsAt } : null,
    checkInCompletedAt: session.checkInCompletedAt,
    signedAgreementUrl: session.signedAgreementUrl,
  };
}

export interface CompleteGuestCheckInInput {
  fullName: string;
  signatureDataUrl: string;
}

export async function completeGuestCheckIn(token: string, input: CompleteGuestCheckInInput) {
  // fullName is validated (guestCheckInRequestSchema) but not persisted — the
  // guest_sessions schema only has room for the signature + completion timestamp, not
  // a guest-registration profile. A future phase can add that if it's wanted.
  void input.fullName;

  const [updated] = await db
    .update(guestSessions)
    .set({ signedAgreementUrl: input.signatureDataUrl, checkInCompletedAt: new Date() })
    .where(eq(guestSessions.token, token))
    .returning();

  return updated ?? null;
}
