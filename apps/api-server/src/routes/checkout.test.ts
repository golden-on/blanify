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
  createAddOn,
  createDiscount,
  unitAddOns,
  discounts,
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
    coupons: {
      create: vi.fn(async () => ({ id: "coupon_test" }) as unknown as Stripe.Coupon),
    },
  };
}

describe.skipIf(!reachable)("POST /api/v1/public/checkout/create-session", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };
  let addOnUnit: { id: string };
  let petFeeAddOn: { id: string };

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

    // A separate unit for add-on/promo-code tests, so attaching a *required* add-on
    // (which affects every checkout for that unit) can't change the expected total of
    // the plain-checkout tests above, which use `unit`.
    addOnUnit = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ accountId: account.id, propertyId: property.id, name: "Add-On Test Unit" })
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
    await ensureNightlyAvailability(account.id, addOnUnit.id, ["2028-08-01", "2028-08-02", "2028-08-03"], 10000);

    await createAddOn(account.id, { unitId: addOnUnit.id, name: "Cleaning fee", priceInCents: 5000, feeType: "per_stay", isRequired: true });
    petFeeAddOn = await createAddOn(account.id, { unitId: addOnUnit.id, name: "Pet fee", priceInCents: 1000, feeType: "per_night", isRequired: false });

    const now = new Date();
    await createDiscount(account.id, {
      code: "PROMO10",
      discountType: "percentage",
      value: 0.1,
      validFrom: new Date(now.getTime() - 86400000).toISOString(),
      validTo: new Date(now.getTime() + 86400000).toISOString(),
    });
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) => tx.delete(discounts).where(eq(discounts.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(unitAddOns).where(eq(unitAddOns.unitId, addOnUnit.id)));
    await withTenant(account.id, (tx) => tx.delete(payments).where(eq(payments.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, addOnUnit.id)));
    await withTenant(account.id, (tx) => tx.delete(stripeAccounts).where(eq(stripeAccounts.accountId, account.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, addOnUnit.id)));
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

  it("always includes a required add-on and multiplies a per-night add-on by nights", async () => {
    const app = Fastify();
    const stripeClient = fakeStripeClient({ paymentIntentId: "pi_test_addons" });
    await registerCheckoutRoutes(app, { stripeClient });
    await app.ready();

    // 3 nights @ 10000 = 30000 nightly; + required Cleaning fee 5000 (per_stay, always
    // included) + selected Pet fee 1000/night * 3 = 3000 -> total 38000.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: {
        accountId: account.id,
        unitId: addOnUnit.id,
        checkIn: "2028-08-01",
        checkOut: "2028-08-04",
        selectedAddOnIds: [petFeeAddOn.id],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: expect.arrayContaining([expect.anything(), expect.anything(), expect.anything()]) }),
    );

    const payment = await withTenant(account.id, async (tx) => {
      const [row] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, "pi_test_addons"));
      return row;
    });
    expect(payment?.amountInCents).toBe(38000);

    await app.close();
  }, 20000);

  it("rejects a selectedAddOnId that doesn't belong to this unit", async () => {
    const app = Fastify();
    await registerCheckoutRoutes(app, { stripeClient: fakeStripeClient() });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: {
        accountId: account.id,
        unitId: addOnUnit.id,
        checkIn: "2028-08-01",
        checkOut: "2028-08-02",
        selectedAddOnIds: ["11111111-1111-1111-1111-111111111111"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_ADD_ON");

    await app.close();
  });

  it("applies a valid promo code as a Stripe coupon and reduces the recorded total", async () => {
    const app = Fastify();
    const stripeClient = fakeStripeClient({ paymentIntentId: "pi_test_promo" });
    await registerCheckoutRoutes(app, { stripeClient });
    await app.ready();

    // 3 nights @ 10000 = 30000 nightly, 10% off = 3000 discount; + required Cleaning
    // fee 5000 (not discounted) -> total 30000 - 3000 + 5000 = 32000.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: {
        accountId: account.id,
        unitId: addOnUnit.id,
        checkIn: "2028-08-01",
        checkOut: "2028-08-04",
        promoCode: "promo10",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(stripeClient.coupons.create).toHaveBeenCalledWith(expect.objectContaining({ amount_off: 3000 }));

    const payment = await withTenant(account.id, async (tx) => {
      const [row] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, "pi_test_promo"));
      return row;
    });
    expect(payment?.amountInCents).toBe(32000);

    await app.close();
  }, 20000);

  it("returns 400 INVALID_PROMO_CODE for an unknown promo code", async () => {
    const app = Fastify();
    const stripeClient = fakeStripeClient();
    await registerCheckoutRoutes(app, { stripeClient });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/checkout/create-session",
      payload: { accountId: account.id, unitId: addOnUnit.id, checkIn: "2028-08-01", checkOut: "2028-08-02", promoCode: "NOPE" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PROMO_CODE");
    expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();

    await app.close();
  });
});
