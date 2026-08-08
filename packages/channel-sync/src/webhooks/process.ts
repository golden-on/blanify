import { and, eq } from "drizzle-orm";
import { ChannelSyncError, webhookPayloadSchema } from "@repo/shared-types";
import {
  db,
  nightsBetween,
  createReservation,
  unblockDates,
  webhookEvents,
  channelUnitMappings,
} from "@repo/db";

export async function processOtaWebhookEvent(webhookEventId: string): Promise<void> {
  const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId));
  if (!event) {
    throw new ChannelSyncError(`Webhook event ${webhookEventId} not found`);
  }

  if (event.status === "processed") {
    // Already handled — avoid reprocessing on job redelivery (BullMQ retry after a lost ack).
    return;
  }

  try {
    const payload = webhookPayloadSchema.parse(event.payload);

    const [mapping] = await db
      .select()
      .from(channelUnitMappings)
      .where(
        and(
          eq(channelUnitMappings.externalPropertyId, payload.externalPropertyId),
          eq(channelUnitMappings.externalRoomId, payload.externalRoomId),
        ),
      );

    if (!mapping) {
      throw new ChannelSyncError(
        `No channel_unit_mapping found for externalPropertyId=${payload.externalPropertyId} externalRoomId=${payload.externalRoomId}`,
      );
    }

    if (payload.eventType === "reservation.created") {
      await createReservation({
        accountId: mapping.accountId,
        unitId: mapping.unitId,
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
      });
    } else {
      const dates = nightsBetween(payload.checkIn, payload.checkOut);
      await unblockDates({ accountId: mapping.accountId, unitId: mapping.unitId, dates });
    }

    await db
      .update(webhookEvents)
      .set({ status: "processed", processedAt: new Date(), errorMessage: null, updatedAt: new Date() })
      .where(eq(webhookEvents.id, webhookEventId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .update(webhookEvents)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(webhookEvents.id, webhookEventId));

    throw err instanceof ChannelSyncError ? err : new ChannelSyncError(`OTA webhook processing failed: ${message}`);
  }
}
