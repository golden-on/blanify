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
  depositClaims,
  ensureNightlyAvailability,
  createReservation,
  recordPendingPayment,
} from "@repo/db";
import { buildApp } from "../app";
import { signToken } from "../auth";
import { registerDepositClaimRoutes, type DepositClient } from "./deposit-claims";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

function fakeDepositClient(): DepositClient {
  return {
    paymentIntents: {
      capture: vi.fn(async (id: string, params: Stripe.PaymentIntentCaptureParams) =>
        ({ id, object: "payment_intent", status: "succeeded", amount_received: params.amount_to_capture }) as unknown as Stripe.PaymentIntent,
      ),
    },
  };
}

describe.skipIf(!reachable)("POST /api/v1/host/reservations/:reservationId/claim-deposit", () => {
  let account: { id: string };
  let unit: { id: string };
  let reservation: { id: string };
  let payment: { id: string };
  let ownerToken: string;
  let cleanerToken: string;

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Deposit Claim Test Tenant" }).returning())[0]!;

    const property = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(properties).values({ accountId: account.id, name: "Property" }).returning();
      return row!;
    });
    unit = await withTenant(account.id, async (tx) => {
      const [row] = await tx.insert(units).values({ accountId: account.id, propertyId: property.id, name: "Unit" }).returning();
      return row!;
    });

    await ensureNightlyAvailability(account.id, unit.id, ["2029-06-01", "2029-06-02"], 20000);
    reservation = await createReservation({ accountId: account.id, unitId: unit.id, checkIn: "2029-06-01", checkOut: "2029-06-03" });

    const pendingPayment = await recordPendingPayment({
      accountId: account.id,
      stripePaymentIntentId: "pi_test_deposit_claim",
      amountInCents: 45000,
      currency: "usd",
    });
    await withTenant(account.id, (tx) =>
      tx.update(payments).set({ reservationId: reservation.id, status: "succeeded" }).where(eq(payments.id, pendingPayment.id)),
    );
    payment = pendingPayment;

    ownerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "host@example.com", role: "owner" });
    cleanerToken = signToken({ sub: crypto.randomUUID(), accountId: account.id, email: "cleaner@example.com", role: "cleaner" });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(depositClaims).where(eq(depositClaims.reservationId, reservation.id)));
    await withTenant(account.id, (tx) => tx.delete(payments).where(eq(payments.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.id, reservation.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.accountId, account.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }, 20000);

  it("captures the requested amount against the reservation's pre-auth hold", async () => {
    const app = Fastify();
    const depositClient = fakeDepositClient();
    await registerDepositClaimRoutes(app, { stripeClient: depositClient });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/claim-deposit`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { amountInCents: 10000, reason: "Broken lamp" },
    });

    expect(response.statusCode).toBe(201);
    expect(depositClient.paymentIntents.capture).toHaveBeenCalledWith("pi_test_deposit_claim", { amount_to_capture: 10000 });
    expect(response.json().depositClaim).toMatchObject({ amountInCents: 10000, reason: "Broken lamp", status: "captured" });

    await app.close();
  }, 20000);

  it("rejects a claim that would exceed the remaining pre-auth hold", async () => {
    const app = Fastify();
    await registerDepositClaimRoutes(app, { stripeClient: fakeDepositClient() });
    await app.ready();

    // The previous test already captured 10000 of the 45000 hold.
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/claim-deposit`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { amountInCents: 40000, reason: "Excessive damage" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("DEPOSIT_AMOUNT_EXCEEDS_HOLD");

    await app.close();
  }, 20000);

  it("returns 400 NO_PREAUTH_HOLD when the reservation has no succeeded payment", async () => {
    await withTenant(account.id, (tx) => tx.update(payments).set({ reservationId: null }).where(eq(payments.id, payment.id)));

    const app = Fastify();
    await registerDepositClaimRoutes(app, { stripeClient: fakeDepositClient() });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/claim-deposit`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { amountInCents: 1000, reason: "Test" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("NO_PREAUTH_HOLD");

    // Restore the link so afterAll's FK-ordered cleanup still finds it.
    await withTenant(account.id, (tx) => tx.update(payments).set({ reservationId: reservation.id }).where(eq(payments.id, payment.id)));

    await app.close();
  }, 20000);

  it("blocks a cleaner-role token from claiming a deposit", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/host/reservations/${reservation.id}/claim-deposit`,
      headers: { authorization: `Bearer ${cleanerToken}` },
      payload: { amountInCents: 1000, reason: "Test" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  }, 20000);
});
