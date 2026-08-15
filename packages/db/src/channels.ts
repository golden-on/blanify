import { eq } from "drizzle-orm";
import type { ChannelStatus } from "@repo/shared-types";
import { withTenant } from "./tenant-context";
import { assertUnitBelongsToAccount } from "./host";
import { channelConnections } from "./schema/channel-connections";
import { unitIcalFeeds } from "./schema/unit-ical-feeds";
import { units } from "./schema/units";

const OTA_CHANNELS = ["airbnb", "booking", "google_vacation_rentals"] as const;

export async function getChannelStatusForAccount(accountId: string): Promise<ChannelStatus[]> {
  return withTenant(accountId, async (tx) => {
    const connections = await tx.select().from(channelConnections);
    const feeds = await tx.select().from(unitIcalFeeds);

    const otaStatuses: ChannelStatus[] = OTA_CHANNELS.map((channel) => {
      const connection = connections.find((c) => c.channel === channel);
      if (!connection) {
        return { channel, status: "not_connected", lastSyncedAt: null };
      }
      return {
        channel,
        status: connection.status === "active" ? "connected" : connection.status,
        lastSyncedAt: connection.updatedAt.toISOString(),
      };
    });

    const lastFeedSync = feeds.reduce<string | null>((latest, feed) => {
      if (!feed.lastSyncedAt) return latest;
      const iso = feed.lastSyncedAt.toISOString();
      return !latest || iso > latest ? iso : latest;
    }, null);

    const icalStatus: ChannelStatus = {
      channel: "ical",
      status: feeds.length === 0 ? "not_connected" : feeds.some((f) => f.syncStatus === "failed") ? "error" : "connected",
      lastSyncedAt: lastFeedSync,
    };

    return [...otaStatuses, icalStatus];
  });
}

export async function listIcalFeedsForAccount(accountId: string) {
  const rows = await withTenant(accountId, (tx) =>
    tx.select({ feed: unitIcalFeeds, unitName: units.name }).from(unitIcalFeeds).innerJoin(units, eq(units.id, unitIcalFeeds.unitId)),
  );
  return rows.map(({ feed, unitName }) => ({ ...feed, unitName }));
}

export interface CreateIcalFeedInput {
  unitId: string;
  name: string;
  url: string;
}

export async function createIcalFeed(accountId: string, input: CreateIcalFeedInput) {
  await assertUnitBelongsToAccount(accountId, input.unitId);

  return withTenant(accountId, async (tx) => {
    const [feed] = await tx.insert(unitIcalFeeds).values({ accountId, unitId: input.unitId, name: input.name, url: input.url }).returning();
    if (!feed) throw new Error("Failed to create iCal feed");
    return feed;
  });
}

export async function deleteIcalFeed(accountId: string, feedId: string): Promise<void> {
  await withTenant(accountId, (tx) => tx.delete(unitIcalFeeds).where(eq(unitIcalFeeds.id, feedId)));
}
