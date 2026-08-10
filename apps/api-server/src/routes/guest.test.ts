import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  reservations,
  nightlyAvailability,
  accessCodes,
  smartLocks,
  guestSessions,
  createReservation,
  ensureNightlyAvailability,
  recordAccessCode,
  computeAccessWindow,
} from "@repo/db";
import { buildApp } from "../app";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

const VALID_SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe.skipIf(!reachable)("Guest portal routes", () => {
  let account: { id: string };
  let unit: { id: string };
  let reservation: { id: string; checkIn: string; checkOut: string };
  let token: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Guest Portal Test Tenant" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Unit", checkInInstructions: "Wifi: Blanify / pass1234" })
        .returning();
      return row!;
    });

    await ensureNightlyAvailability(account.id, unit.id, ["2029-01-01", "2029-01-02"]);
    reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2029-01-01", checkOut: "2029-01-03" });

    const lock = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(smartLocks)
        .values({ accountId: account.id, unitId: unit.id, provider: "seam", externalDeviceId: "dev_1", deviceName: "Front Door" })
        .returning();
      return row!;
    });

    const window = computeAccessWindow(reservation.checkIn, reservation.checkOut);
    await recordAccessCode({
      accountId: account.id,
      reservationId: reservation.id,
      smartLockId: lock.id,
      code: "4821",
      externalAccessCodeId: null,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    token = "test-guest-token-abc123";
    await db.insert(guestSessions).values({ accountId: account.id, reservationId: reservation.id, token });
  });

  afterAll(async () => {
    await db.delete(guestSessions).where(eq(guestSessions.reservationId, reservation.id));
    await withTenant(account.id, (tx) => tx.delete(accessCodes).where(eq(accessCodes.reservationId, reservation.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.id, reservation.id)));
    await withTenant(account.id, (tx) => tx.delete(smartLocks).where(eq(smartLocks.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("resolves the reservation, unit guidebook text, and the active lock PIN by token", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: `/api/v1/public/guest/${token}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.reservation).toMatchObject({ checkIn: "2029-01-01", checkOut: "2029-01-03" });
    expect(body.unit).toMatchObject({ name: "Unit", checkInInstructions: "Wifi: Blanify / pass1234" });
    expect(body.lockCode).toMatchObject({ code: "4821" });
    expect(body.checkInCompletedAt).toBeNull();

    await app.close();
  }, 20000);

  it("returns 404 for an unknown token", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/public/guest/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("GUEST_SESSION_NOT_FOUND");

    await app.close();
  }, 20000);

  it("rejects a check-in submission with a non-image signatureDataUrl", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/public/guest/${token}/check-in`,
      payload: { fullName: "Jane Doe", signatureDataUrl: "not-a-data-url" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  }, 20000);

  it("completes check-in and reflects it on a subsequent portal fetch", async () => {
    const app = buildApp();

    const checkInResponse = await app.inject({
      method: "POST",
      url: `/api/v1/public/guest/${token}/check-in`,
      payload: { fullName: "Jane Doe", signatureDataUrl: VALID_SIGNATURE },
    });
    expect(checkInResponse.statusCode).toBe(200);
    expect(checkInResponse.json().checkInCompletedAt).not.toBeNull();

    const portalResponse = await app.inject({ method: "GET", url: `/api/v1/public/guest/${token}` });
    expect(portalResponse.json().checkInCompletedAt).not.toBeNull();
    expect(portalResponse.json().signedAgreementUrl).toBe(VALID_SIGNATURE);

    await app.close();
  }, 20000);
});
