import { db } from "./client";
import { webhookEvents, channelType } from "./schema";

type Channel = (typeof channelType.enumValues)[number];

export async function recordWebhookEvent(channel: Channel, externalEventId: string, payload: unknown) {
  const [row] = await db
    .insert(webhookEvents)
    .values({ channel, externalEventId, payload })
    .onConflictDoNothing({
      target: [webhookEvents.channel, webhookEvents.externalEventId],
    })
    .returning();

  return row;
}
