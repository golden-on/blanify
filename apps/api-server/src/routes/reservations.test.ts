import Fastify from "fastify";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  reservations,
  nightlyAvailability,
  payments,
  ensureNightlyAvailability,
  createReservation,
  recordPendingPayment,
} from "@repo/db";
import { signToken } from "../auth";
import { registerReservationRoutes, type ReservationRefundClient } from "./reservations";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

function fakeRefundClient(): ReservationRefundClient {
  return {
    refunds: {
      create: vi.fn(async (params: Stripe.RefundCreateParams) =>
        ({ id: "re_test_fake", object: "refund", status: "succeeded", amount: params.amount }) as unknown as Stripe.Refund,
      ),
    },
  };
}

describe.skipIf(!reachable)("POST /api/v1/host/reservations/:reservationId/cancel", () => {
  let account: { id: string };
  let otherAccount: { id: string };
  let unit: { id: string };
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Cancel Reservation Test Tenant" }).returning())[0]!;
    otherAccount = (await db.insert(accounts).values({ name: "Cancel Reservation Test Tenant B" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    ownerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    otherToken = signToken({ sub: crypto.randomUUID(), accountId: otherAccount.id, email: "other@example.com", role: "owner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(payments).where(eq(payments.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 40000);

  it("releases the booked nights and marks the reservation cancelled", async () => {
    const app = Fastify();
    await registerReservationRoutes(app, { stripeClient: fakeRefundClient() });
    await app.ready();

    await ensureNightlyAvailability(account.id, unit.id, ["2030-08-01", "2030-08-02"], 15000);
    const reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2030-08-01", checkOut: "2030-08-03" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reservation).toMatchObject({ id: reservation.id, status: "cancelled" });

    const nights = await withTenant(account.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    const releasedNights = nights.filter((n) => n.date === "2030-08-01" || n.date === "2030-08-02");
    expect(releasedNights).toHaveLength(2);
    for (const night of releasedNights) {
      expect(night.status).toBe("available");
      expect(night.reservationId).toBeNull();
    }

    await app.close();
  }, 40000);

  it("returns 400 ALREADY_CANCELLED on a second cancellation attempt", async () => {
    const app = Fastify();
    await registerReservationRoutes(app, { stripeClient: fakeRefundClient() });
    await app.ready();

    await ensureNightlyAvailability(account.id, unit.id, ["2030-09-01"], 10000);
    const reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2030-09-01", checkOut: "2030-09-02" });

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe("ALREADY_CANCELLED");

    await app.close();
  }, 40000);

  it("refunds the payment when refund: true and marks it refunded", async () => {
    const app = Fastify();
    const refundClient = fakeRefundClient();
    await registerReservationRoutes(app, { stripeClient: refundClient });
    await app.ready();

    await ensureNightlyAvailability(account.id, unit.id, ["2030-10-01"], 30000);
    const reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2030-10-01", checkOut: "2030-10-02" });

    const pendingPayment = await recordPendingPayment({
      accountId: account.id,
      stripePaymentIntentId: "pi_test_cancel_refund",
      amountInCents: 30000,
      currency: "usd",
    });
    await withTenant(account.id, (tx) =>
      tx.update(payments).set({ reservationId: reservation.id, status: "succeeded" }).where(eq(payments.id, pendingPayment.id)),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { refund: true },
    });

    expect(response.statusCode).toBe(200);
    expect(refundClient.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_test_cancel_refund", amount: 30000 });

    const [updatedPayment] = await withTenant(account.id, (tx) => tx.select().from(payments).where(eq(payments.id, pendingPayment.id)));
    expect(updatedPayment?.status).toBe("refunded");

    await app.close();
  }, 40000);

  it("returns 400 NO_REFUNDABLE_PAYMENT when refund is requested but no succeeded payment exists", async () => {
    const app = Fastify();
    await registerReservationRoutes(app, { stripeClient: fakeRefundClient() });
    await app.ready();

    await ensureNightlyAvailability(account.id, unit.id, ["2030-11-01"], 10000);
    const reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2030-11-01", checkOut: "2030-11-02" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { refund: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("NO_REFUNDABLE_PAYMENT");

    await app.close();
  }, 40000);

  it("returns 404 for a reservation belonging to a different tenant", async () => {
    const app = Fastify();
    await registerReservationRoutes(app, { stripeClient: fakeRefundClient() });
    await app.ready();

    await ensureNightlyAvailability(account.id, unit.id, ["2030-12-01"], 10000);
    const reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2030-12-01", checkOut: "2030-12-02" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/cancel`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  }, 40000);
});
