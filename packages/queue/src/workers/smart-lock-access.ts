import { Worker, QueueEvents } from "bullmq";
import { ChannelSyncError, smartLockAccessJobSchema, inboxChannelForAccount } from "@repo/shared-types";
import { computeAccessWindow, getReservationById, getSmartLockForUnit, recordAccessCode } from "@repo/db";
import { seamLockDriver } from "@repo/smart-locks";
import { connection } from "../connection";
import { SMART_LOCK_ACCESS_QUEUE, smartLockAccessQueue, smartLockAccessDlq } from "../queues/smart-lock-access";

export const smartLockAccessWorker = new Worker(
  SMART_LOCK_ACCESS_QUEUE,
  async (job) => {
    const { accountId, reservationId } = smartLockAccessJobSchema.parse(job.data);

    const reservation = await getReservationById(accountId, reservationId);
    if (!reservation) {
      throw new ChannelSyncError(`Reservation ${reservationId} not found for account ${accountId}`);
    }

    const smartLock = await getSmartLockForUnit(accountId, reservation.unitId);
    if (!smartLock) {
      // Not every unit has a smart lock configured — nothing to do.
      return { skipped: true };
    }

    const { startsAt, endsAt } = computeAccessWindow(reservation.checkIn, reservation.checkOut);

    const { accessCodeId, code } = await seamLockDriver.generateAccessCode({
      reservationId,
      externalDeviceId: smartLock.externalDeviceId,
      startsAt,
      endsAt,
    });

    const result = await recordAccessCode({
      accountId,
      reservationId,
      smartLockId: smartLock.id,
      code,
      externalAccessCodeId: accessCodeId,
      startsAt,
      endsAt,
    });

    if (result?.dispatch) {
      // PUBLISH is a normal Redis command, safe to run on the shared BullMQ
      // connection (unlike SUBSCRIBE, which requires a dedicated connection).
      await connection.publish(
        inboxChannelForAccount(accountId),
        JSON.stringify({ threadId: result.dispatch.threadId, message: result.dispatch.message }),
      );
    }

    return { provisioned: result !== null };
  },
  { connection },
);

export const smartLockAccessEvents = new QueueEvents(SMART_LOCK_ACCESS_QUEUE, { connection });

smartLockAccessEvents.on("failed", async ({ jobId }) => {
  const job = await smartLockAccessQueue.getJob(jobId);
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await smartLockAccessDlq.add("dead-letter", job.data);
  }
});

smartLockAccessWorker.on("ready", () => {
  console.log("Smart lock access worker ready");
});
