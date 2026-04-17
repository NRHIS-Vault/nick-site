import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  profileSelectMock: vi.fn(),
  profileEqMock: vi.fn(),
  profileOrderMock: vi.fn(),
  profileLimitMock: vi.fn(),
  featureSelectMock: vi.fn(),
  featureEqMock: vi.fn(),
  featureOrderMock: vi.fn(),
  beaconSelectMock: vi.fn(),
  beaconEqMock: vi.fn(),
  beaconOrderMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { onRequestGet } from "./identity";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
};

const createRequest = (headers: Record<string, string> = {}) =>
  new Request("https://example.com/identity", {
    headers: {
      Authorization: "Bearer access-token",
      ...headers,
    },
  });

describe("identity worker", () => {
  beforeEach(() => {
    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.getUserMock.mockReset();
    supabaseMocks.profileSelectMock.mockReset();
    supabaseMocks.profileEqMock.mockReset();
    supabaseMocks.profileOrderMock.mockReset();
    supabaseMocks.profileLimitMock.mockReset();
    supabaseMocks.featureSelectMock.mockReset();
    supabaseMocks.featureEqMock.mockReset();
    supabaseMocks.featureOrderMock.mockReset();
    supabaseMocks.beaconSelectMock.mockReset();
    supabaseMocks.beaconEqMock.mockReset();
    supabaseMocks.beaconOrderMock.mockReset();

    supabaseMocks.getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
      error: null,
    });

    supabaseMocks.profileLimitMock.mockResolvedValue({
      data: [
        {
          id: "rhnis-1",
          profile_id: "user-1",
          beacon_signature: "RHNIS-ALPHA",
          legacy_stats: {
            voice_recordings_mb: 2300,
            interaction_logs_mb: 456,
            digital_signatures_mb: 12,
            notes: ["Encrypted offsite copy available."],
          },
          created_at: "2026-04-10T12:00:00.000Z",
          updated_at: "2026-04-15T17:30:00.000Z",
        },
      ],
      error: null,
    });
    supabaseMocks.profileOrderMock.mockReturnValue({
      limit: supabaseMocks.profileLimitMock,
    });
    supabaseMocks.profileEqMock.mockReturnValue({
      order: supabaseMocks.profileOrderMock,
    });
    supabaseMocks.profileSelectMock.mockReturnValue({
      eq: supabaseMocks.profileEqMock,
    });

    supabaseMocks.featureOrderMock.mockResolvedValue({
      data: [
        {
          icon: "fingerprint",
          title: "Voice Signature",
          status: "Active",
          description: "Stored voiceprint identity markers.",
          created_at: "2026-04-10T12:05:00.000Z",
        },
        {
          icon: "shield",
          title: "Sting Mode",
          status: "Maintenance",
          description: "Outbound trap automation paused for review.",
          created_at: "2026-04-11T08:00:00.000Z",
        },
      ],
      error: null,
    });
    supabaseMocks.featureEqMock.mockReturnValue({
      order: supabaseMocks.featureOrderMock,
    });
    supabaseMocks.featureSelectMock.mockReturnValue({
      eq: supabaseMocks.featureEqMock,
    });

    supabaseMocks.beaconOrderMock.mockResolvedValue({
      data: [
        {
          beacon_type: "Interactions",
          count: 1542,
          status: "Tracking",
          created_at: "2026-04-15T17:00:00.000Z",
        },
        {
          beacon_type: "Comments",
          count: 597,
          status: "Propagating",
          created_at: "2026-04-15T16:00:00.000Z",
        },
      ],
      error: null,
    });
    supabaseMocks.beaconEqMock.mockReturnValue({
      order: supabaseMocks.beaconOrderMock,
    });
    supabaseMocks.beaconSelectMock.mockReturnValue({
      eq: supabaseMocks.beaconEqMock,
    });

    supabaseMocks.fromMock.mockImplementation((table: string) => {
      if (table === "rhnis_profiles") {
        return { select: supabaseMocks.profileSelectMock };
      }

      if (table === "rhnis_identity_features") {
        return { select: supabaseMocks.featureSelectMock };
      }

      if (table === "rhnis_beacon_data") {
        return { select: supabaseMocks.beaconSelectMock };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    supabaseMocks.createClientMock.mockReturnValue({
      auth: {
        getUser: supabaseMocks.getUserMock,
      },
      from: supabaseMocks.fromMock,
    });
  });

  it("returns a tab-oriented RHNIS payload for the authenticated user", async () => {
    const response = await onRequestGet({
      request: createRequest(),
      env,
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      source: "supabase",
      userId: "user-1",
      profileId: "rhnis-1",
      hasProfile: true,
      identity: {
        summary: {
          totalFeatures: 2,
          activeFeatures: 1,
          lastUpdatedAt: "2026-04-15T17:30:00.000Z",
        },
        features: expect.arrayContaining([
          expect.objectContaining({
            icon: "fingerprint",
            title: "Voice Signature",
            createdAt: "2026-04-10T12:05:00.000Z",
          }),
        ]),
      },
      beacon: {
        summary: {
          signature: "RHNIS-ALPHA",
          totalSignals: 2139,
          activeStreams: 2,
          recordTypes: 2,
          lastUpdatedAt: "2026-04-15T17:30:00.000Z",
        },
        data: expect.arrayContaining([
          expect.objectContaining({
            type: "Interactions",
            count: 1542,
            status: "Tracking",
          }),
        ]),
      },
      legacy: {
        stats: {
          voiceRecordingsMb: 2300,
          interactionLogsMb: 456,
          digitalSignaturesMb: 12,
          totalStorageMb: 2768,
        },
        details: expect.arrayContaining([
          expect.objectContaining({
            id: "voice-recordings",
            sizeMb: 2300,
            status: "Available",
          }),
        ]),
        notes: ["Encrypted offsite copy available."],
        profileCreatedAt: "2026-04-10T12:00:00.000Z",
        lastUpdatedAt: "2026-04-15T17:30:00.000Z",
      },
    });
    expect(typeof body.computedAt).toBe("string");

    expect(supabaseMocks.getUserMock).toHaveBeenCalledWith("access-token");
    expect(supabaseMocks.profileEqMock).toHaveBeenCalledWith("profile_id", "user-1");
    expect(supabaseMocks.featureEqMock).toHaveBeenCalledWith("rhnis_profile_id", "rhnis-1");
    expect(supabaseMocks.beaconEqMock).toHaveBeenCalledWith("rhnis_profile_id", "rhnis-1");
  });

  it("returns an empty payload when the authenticated user has no RHNIS profile", async () => {
    supabaseMocks.profileLimitMock.mockResolvedValue({
      data: [],
      error: null,
    });

    const response = await onRequestGet({
      request: createRequest(),
      env,
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      source: "supabase",
      userId: "user-1",
      profileId: null,
      hasProfile: false,
      identity: {
        summary: {
          totalFeatures: 0,
          activeFeatures: 0,
        },
        features: [],
      },
      beacon: {
        summary: {
          signature: null,
          totalSignals: 0,
          activeStreams: 0,
          recordTypes: 0,
        },
        data: [],
      },
      legacy: {
        stats: {
          voiceRecordingsMb: 0,
          interactionLogsMb: 0,
          digitalSignaturesMb: 0,
          totalStorageMb: 0,
        },
        notes: [],
      },
    });
    expect(supabaseMocks.featureSelectMock).not.toHaveBeenCalled();
    expect(supabaseMocks.beaconSelectMock).not.toHaveBeenCalled();
  });

  it("rejects requests without a bearer token", async () => {
    const response = await onRequestGet({
      request: createRequest({
        Authorization: "",
      }),
      env,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "IDENTITY_AUTH_REQUIRED",
      error: "Missing Authorization bearer token.",
    });
  });
});
