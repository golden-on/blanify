import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConcurrencyError } from "@repo/shared-types";
import { db } from "../client";
import { withTenant } from "../tenant-context";
import { createReservation } from "../inventory";
import { accounts } from "./accounts";
import { properties } from "./properties";
import { units } from "./units";
import { reservations } from "./reservations";
import { nightlyAvailability } from "./nightly-availability";

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("concurrent reservation creation", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "Concurrency Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "Concurrency Test Property" })
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
  });

  afterAll(async () => {
    await withTenant(account.id, (tx) =>
      tx.delete(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    await withTenant(account.id, (tx) => tx.delete(reservations).where(eq(reservations.unitId, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  });

  it("only allows one of two concurrent bookings for the same nights to succeed", async () => {
    const input = {
      accountId: account.id,
      unitId: unit.id,
      checkIn: "2027-01-01",
      checkOut: "2027-01-04",
    };

    const results = await Promise.allSettled([createReservation(input), createReservation(input)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);

    const rows = await withTenant(account.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "booked")).toBe(true);
  });
});
