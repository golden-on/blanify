import { Redis } from "ioredis";
import { inboxChannelForAccount } from "@repo/shared-types";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// A single connection reused for PUBLISH — a normal command, safe to share.
const publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export { inboxChannelForAccount };

export async function publishInboxMessage(accountId: string, payload: unknown): Promise<void> {
  await publisher.publish(inboxChannelForAccount(accountId), JSON.stringify(payload));
}

// SUBSCRIBE puts a connection into a restricted mode, so every WS connection gets its
// own dedicated subscriber rather than sharing `publisher`.
export function createSubscriber(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null });
}
