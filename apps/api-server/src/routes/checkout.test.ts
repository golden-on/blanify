import Fastify from "fastify";
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  nightlyAvailability,
  stripeAccounts,
  payments,
  ensureNightlyAvailability,
} from "@repo/db";
import { registerCheckoutRoutes, type CheckoutClient } from "./checkout";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

function fakeStripeClient(overrides: Partial<{ paymentIntentId: string }> = {}): CheckoutClient {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () =>
          ({
            id: "cs_test_fake_session",
            url: "https://checkout.stripe.com/test-session",
            payment_intent: overrides.paymentIntentId ?? "pi_test_fake",
          }) as unknown as Stripe.Checkout.Session,
        ),
      },
    },
  };
}

describe.skipIf(!reachable)("POST /api/v1/public/checkout/create-session", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Checkout Route Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "Checkout Route Test Property" })
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

    await withTenant(account.id, (tx) =>
      tx.insert(stripeAccounts).values({
        accountId: account.id,
        stripeAccountId: "acct_test_checkout_route",
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    );

    await ensureNightlyAvailability(account.id, unit.id, ["2028-07-01", "2028-07-02"], 15000);
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(payments).where(eq(payments.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(stripeAccounts).where(eq(stripeAccounts.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  });

  it("creates a checkout session and a pending payment for available, priced nights", async () => {
    const app = Fastify();
    const stripeClient = fakeStripeClient({ paymentIntentId: "pi_test_checkout_success" });
    await registerCheckoutRoutes(app, { stripeClient });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: { accountId: account.id, unitId: unit.id, checkIn: "2028-07-01", checkOut: "2028-07-03" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessionId: "cs_test_fake_session",
      url: "https://checkout.stripe.com/test-session",
    });
    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledTimes(1);

    const payment = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, "pi_test_checkout_success"));
      return row;
    });
    expect(payment).toMatchObject({ status: "pending", amountInCents: 30000, currency: "usd" });

    await app.close();
  }, 20000);

  it("returns STRIPE_ACCOUNT_NOT_READY when the tenant has no connected Stripe account", async () => {
    const otherAccount = (await db.insert(accounts).values({ name: "No Stripe Account Tenant" }).returning())[0]!;
    const otherProperty = await withTenant(otherAccount.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: otherAccount.id, name: "Property" })
        .returning();
      return row!;
    });
    const otherUnit = await withTenant(otherAccount.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: otherAccount.id, propertyId: otherProperty.id, name: "Unit" })
        .returning();
      return row!;
    });
    await ensureNightlyAvailability(otherAccount.id, otherUnit.id, ["2028-07-05", "2028-07-06"], 10000);

    const app = Fastify();
    await registerCheckoutRoutes(app, { stripeClient: fakeStripeClient() });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: { accountId: otherAccount.id, unitId: otherUnit.id, checkIn: "2028-07-05", checkOut: "2028-07-07" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("STRIPE_ACCOUNT_NOT_READY");

    await app.close();

    await withTenant(otherAccount.id, (tx) =>
      tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, otherUnit.id)),
    );
    await withTenant(otherAccount.id, (tx) => tx.delete(units).where(eq(units.id, otherUnit.id)));
    await withTenant(otherAccount.id, (tx) => tx.delete(properties).where(eq(properties.id, otherProperty.id)));
    await db.delete(accounts).where(eq(accounts.id, otherAccount.id));
  }, 20000);

  it("returns DATES_UNAVAILABLE when a requested night has no availability record", async () => {
    const app = Fastify();
    await registerCheckoutRoutes(app, { stripeClient: fakeStripeClient({ paymentIntentId: "pi_test_should_not_be_used" }) });
    await app.ready();

    // 2028-07-02 is available but 2028-07-03 was never primed with pricing/availability,
    // so the row count won't match the requested date range.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: { accountId: account.id, unitId: unit.id, checkIn: "2028-07-02", checkOut: "2028-07-04" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DATES_UNAVAILABLE");

    await app.close();
  });
});
