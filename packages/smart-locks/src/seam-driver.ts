import { ChannelSyncError } from "@repo/shared-types";
import type { GenerateAccessCodeInput, GenerateAccessCodeResult, LockDriver, RevokeAccessCodeInput } from "./types";

export interface SeamHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SeamFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<SeamHttpResponse>;

export interface SeamLockDriverOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: SeamFetch;
}

function randomPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Talks to Seam's REST API directly via fetch rather than an npm SDK — no `seam`
// package is installed anywhere in this repo, and this keeps the same DI-testable
// shape as the Stripe client wrapper (no real network call from tests).
export class SeamLockDriver implements LockDriver {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: SeamFetch;

  constructor(options: SeamLockDriverOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://connect.getseam.com";
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as SeamFetch);
  }

  async generateAccessCode(input: GenerateAccessCodeInput): Promise<GenerateAccessCodeResult> {
    const code = randomPin();

    const response = await this.fetchImpl(`${this.baseUrl}/access_codes/create`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: input.externalDeviceId,
        code,
        starts_at: input.startsAt.toISOString(),
        ends_at: input.endsAt.toISOString(),
      }),
    });

    if (!response.ok) {
      throw new ChannelSyncError(`Seam access code creation failed with status ${response.status}`);
    }

    const body = (await response.json()) as { access_code?: { access_code_id?: string } };
    const accessCodeId = body.access_code?.access_code_id;
    if (!accessCodeId) {
      throw new ChannelSyncError("Seam access code creation response did not include an access_code_id");
    }

    return { accessCodeId, code };
  }

  async revokeAccessCode(input: RevokeAccessCodeInput): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/access_codes/delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ access_code_id: input.accessCodeId }),
    });

    if (!response.ok) {
      throw new ChannelSyncError(`Seam access code revocation failed with status ${response.status}`);
    }
  }
}

export const seamLockDriver: LockDriver = new SeamLockDriver({
  apiKey: process.env.SEAM_API_KEY ?? "seam_dev_placeholder",
});
