import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  withTenant,
  accounts,
  properties,
  units,
  nightlyAvailability,
} from "@repo/db";
import { reconcileICalFeed } from "./import";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event-1@example.com
DTSTART;VALUE=DATE:20270501
DTEND;VALUE=DATE:20270504
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;

let reachable = true;
try {
  await db.execute(sql`select 1`);
} catch {
  reachable = false;
}

describe.skipIf(!reachable)("iCal import reconciliation", () => {
  let account: { id: string };
  let property: { id: string };
  let unit: { id: string };

  beforeAll(async () => {
    account = (await db.insert(accounts).values({ name: "iCal Sync Test Tenant" }).returning())[0]!;

    property = await withTenant(account.id, async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ accountId: account.id, name: "iCal Sync Test Property" })
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
    await withTenant(account.id, (tx) => tx.delete(units).where(eq(units.id, unit.id)));
    await withTenant(account.id, (tx) => tx.delete(properties).where(eq(properties.id, property.id)));
    await db.delete(accounts).where(eq(accounts.id, account.id));
  });

  it("parses a VEVENT and blocks the corresponding nights", async () => {
    await reconcileICalFeed(account.id, unit.id, SAMPLE_ICS);

    const rows = await withTenant(account.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );

    const dates = rows.map((row) => row.date).sort();
    expect(dates).toEqual(["2027-05-01", "2027-05-02", "2027-05-03"]);
    expect(rows.every((row) => row.status === "blocked")).toBe(true);
  });

  it("is idempotent on re-sync", async () => {
    await reconcileICalFeed(account.id, unit.id, SAMPLE_ICS);

    const rows = await withTenant(account.id, (tx) =>
      tx.select().from(nightlyAvailability).where(eq(nightlyAvailability.unitId, unit.id)),
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "blocked")).toBe(true);
  });
});
