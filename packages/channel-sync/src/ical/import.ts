import ical from "node-ical";
import { eq } from "drizzle-orm";
import { ChannelSyncError } from "@repo/shared-types";
import { withTenant, nightsBetween, blockDates, unitIcalFeeds } from "@repo/db";

export interface ParsedIcalRange {
  checkIn: string;
  checkOut: string;
}

// node-ical returns all-day (DATE-only) VEVENT start/end as Date objects constructed from
// local Y/M/D components, not UTC — using toISOString() here would shift the date by a day
// in any timezone ahead of UTC. Read the local calendar date components it set instead.
function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseICalEvents(icsText: string): ParsedIcalRange[] {
  const parsed = ical.sync.parseICS(icsText);

  return Object.values(parsed)
    .filter((component): component is ical.VEvent => component.type === "VEVENT")
    .map((event) => ({
      checkIn: toDateString(event.start),
      checkOut: toDateString(event.end),
    }));
}

export async function reconcileICalFeed(
  accountId: string,
  unitId: string,
  icsText: string,
): Promise<void> {
  const ranges = parseICalEvents(icsText);

  for (const range of ranges) {
    const dates = nightsBetween(range.checkIn, range.checkOut);
    await blockDates({ accountId, unitId, dates });
  }
}

export async function syncICalFeed(feedId: string, accountId: string): Promise<void> {
  const feed = await withTenant(accountId, async (tx) => {
    const [row] = await tx.select().from(unitIcalFeeds).where(eq(unitIcalFeeds.id, feedId));
    return row;
  });

  if (!feed) {
    throw new ChannelSyncError(`iCal feed ${feedId} not found for account ${accountId}`);
  }

  try {
    const response = await fetch(feed.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch iCal feed: HTTP ${response.status}`);
    }
    const icsText = await response.text();

    await reconcileICalFeed(accountId, feed.unitId, icsText);

    await withTenant(accountId, (tx) =>
      tx
        .update(unitIcalFeeds)
        .set({ syncStatus: "success", lastSyncedAt: new Date(), errorMessage: null, updatedAt: new Date() })
        .where(eq(unitIcalFeeds.id, feedId)),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await withTenant(accountId, (tx) =>
      tx
        .update(unitIcalFeeds)
        .set({ syncStatus: "failed", errorMessage: message, updatedAt: new Date() })
        .where(eq(unitIcalFeeds.id, feedId)),
    );

    throw new ChannelSyncError(`iCal sync failed for feed ${feedId}: ${message}`);
  }
}
