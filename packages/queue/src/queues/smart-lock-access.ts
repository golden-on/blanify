import { Queue } from "bullmq";
import type { SmartLockAccessJob } from "@repo/shared-types";
import { connection } from "../connection";

export const SMART_LOCK_ACCESS_QUEUE = "smart-lock-access";
export const SMART_LOCK_ACCESS_DLQ = "smart-lock-access-dlq";

export const smartLockAccessQueue = new Queue<SmartLockAccessJob>(SMART_LOCK_ACCESS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const smartLockAccessDlq = new Queue<SmartLockAccessJob>(SMART_LOCK_ACCESS_DLQ, { connection });

export async function enqueueSmartLockAccess(job: SmartLockAccessJob) {
  return smartLockAccessQueue.add("provision", job);
}
