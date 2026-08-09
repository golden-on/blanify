export class ConcurrencyError extends Error {
  readonly code = "CONCURRENCY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export class ChannelSyncError extends Error {
  readonly code = "CHANNEL_SYNC_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "ChannelSyncError";
  }
}

export class TenantAccessError extends Error {
  readonly code = "TENANT_ACCESS_DENIED";

  constructor(message: string) {
    super(message);
    this.name = "TenantAccessError";
  }
}
