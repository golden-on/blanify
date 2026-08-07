export class ConcurrencyError extends Error {
  readonly code = "CONCURRENCY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}
