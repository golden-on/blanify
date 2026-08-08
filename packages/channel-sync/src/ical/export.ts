import ical from "ical-generator";
import { and, eq } from "drizzle-orm";
import { withTenant, addDays, reservations, nightlyAvailability } from "@repo/db";

function groupConsecutiveDates(dates: string[]): { start: string; end: string }[] {
  if (dates.length === 0) return [];

  const sorted = [...dates].sort();
  const ranges: { start: string; end: string }[] = [];
  let rangeStart = sorted[0]!;
  let rangeEnd = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    if (current === addDays(rangeEnd, 1)) {
      rangeEnd = current;
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = current;
      rangeEnd = current;
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });

  return ranges;
}

function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export async function generateUnitICal(unitId: string, accountId: string): Promise<string> {
  return withTenant(accountId, async (tx) => {
    const calendar = ical({ name: `Unit ${unitId} Availability` });

    const bookings = await tx.select().from(reservations).where(eq(reservations.unitId, unitId));
    for (const booking of bookings) {
      calendar.createEvent({
        start: toUtcDate(booking.checkIn),
        end: toUtcDate(booking.checkOut),
        allDay: true,
        summary: "Booked",
      });
    }

    const blockedRows = await tx
      .select({ date: nightlyAvailability.date })
      .from(nightlyAvailability)
      .where(and(eq(nightlyAvailability.unitId, unitId), eq(nightlyAvailability.status, "blocked")))
      .orderBy(nightlyAvailability.date);

    const blockedRanges = groupConsecutiveDates(blockedRows.map((row) => row.date));
    for (const range of blockedRanges) {
      calendar.createEvent({
        start: toUtcDate(range.start),
        end: toUtcDate(addDays(range.end, 1)),
        allDay: true,
        summary: "Blocked",
      });
    }

    return calendar.toString();
  });
}
