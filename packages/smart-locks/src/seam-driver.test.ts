import { describe, expect, it, vi } from "vitest";
import { ChannelSyncError } from "@repo/shared-types";
import { SeamLockDriver } from "./seam-driver";
import type { SeamFetch, SeamHttpResponse } from "./seam-driver";

function jsonResponse(status: number, body: unknown): SeamHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("SeamLockDriver", () => {
  it("generateAccessCode posts the device id and window, and parses the returned access_code_id", async () => {
    const fetchImpl: SeamFetch = vi.fn(async () => jsonResponse(200, { access_code: { access_code_id: "seam_ac_1" } }));
    const driver = new SeamLockDriver({ apiKey: "sk_test_seam", fetchImpl });

    const startsAt = new Date("2026-09-01T15:00:00Z");
    const endsAt = new Date("2026-09-05T11:00:00Z");

    const result = await driver.generateAccessCode({
      reservationId: "11111111-1111-1111-1111-111111111111",
      externalDeviceId: "device_abc",
      startsAt,
      endsAt,
    });

    expect(result).toEqual({ accessCodeId: "seam_ac_1", code: expect.stringMatching(/^\d{6}$/) });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://connect.getseam.com/access_codes/create");
    expect(init.headers.Authorization).toBe("Bearer sk_test_seam");
    const body = JSON.parse(init.body) as { device_id: string; starts_at: string; ends_at: string };
    expect(body.device_id).toBe("device_abc");
    expect(body.starts_at).toBe(startsAt.toISOString());
    expect(body.ends_at).toBe(endsAt.toISOString());
  });

  it("throws ChannelSyncError when Seam returns a non-ok response", async () => {
    const fetchImpl: SeamFetch = vi.fn(async () => jsonResponse(500, {}));
    const driver = new SeamLockDriver({ apiKey: "sk_test_seam", fetchImpl });

    await expect(
      driver.generateAccessCode({
        reservationId: "11111111-1111-1111-1111-111111111111",
        externalDeviceId: "device_abc",
        startsAt: new Date(),
        endsAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(ChannelSyncError);
  });

  it("revokeAccessCode posts the access_code_id", async () => {
    const fetchImpl: SeamFetch = vi.fn(async () => jsonResponse(200, {}));
    const driver = new SeamLockDriver({ apiKey: "sk_test_seam", fetchImpl });

    await driver.revokeAccessCode({ accessCodeId: "seam_ac_1" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://connect.getseam.com/access_codes/delete");
    expect(JSON.parse(init.body)).toEqual({ access_code_id: "seam_ac_1" });
  });
});
