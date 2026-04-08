import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { onRequestPost } from "./save-keys";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
  TRADING_KEYS_ENCRYPTION_KEY: "12345678901234567890123456789012",
};

const createSaveKeysRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://example.com/trading/save-keys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("trading save-keys worker", () => {
  beforeEach(() => {
    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.getUserMock.mockReset();
    supabaseMocks.upsertMock.mockReset();

    supabaseMocks.getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
      error: null,
    });
    supabaseMocks.upsertMock.mockResolvedValue({ error: null });
    supabaseMocks.fromMock.mockReturnValue({
      upsert: supabaseMocks.upsertMock,
    });
    supabaseMocks.createClientMock.mockReturnValue({
      auth: {
        getUser: supabaseMocks.getUserMock,
      },
      from: supabaseMocks.fromMock,
    });
  });

  it("encrypts exchange credentials and upserts them by user and exchange", async () => {
    const response = await onRequestPost({
      request: createSaveKeysRequest({
        exchanges: [
          {
            exchangeId: "binance",
            apiKey: "plain-api-key",
            secret: "plain-secret",
          },
        ],
      }),
      env,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      saved: ["binance"],
    });
    expect(JSON.stringify(body)).not.toContain("plain-secret");
    expect(supabaseMocks.getUserMock).toHaveBeenCalledWith("access-token");
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("exchange_keys");
    expect(supabaseMocks.upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: "user-1",
          exchange_id: "binance",
          encryption_algorithm: "AES-GCM",
          key_version: "v1",
        }),
      ],
      { onConflict: "user_id,exchange_id" }
    );

    const [rows] = supabaseMocks.upsertMock.mock.calls[0];
    expect(rows[0].api_key_ciphertext).not.toBe("plain-api-key");
    expect(rows[0].secret_ciphertext).not.toBe("plain-secret");
    expect(rows[0].api_key_iv).toEqual(expect.any(String));
    expect(rows[0].secret_iv).toEqual(expect.any(String));
  });

  it("requires a Supabase bearer token before saving credentials", async () => {
    const response = await onRequestPost({
      request: createSaveKeysRequest(
        {
          exchanges: [
            {
              exchangeId: "binance",
              apiKey: "plain-api-key",
              secret: "plain-secret",
            },
          ],
        },
        {
          Authorization: "",
        }
      ),
      env,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Missing Authorization bearer token.",
    });
    expect(supabaseMocks.upsertMock).not.toHaveBeenCalled();
  });

  it("rejects incomplete credential pairs without writing to Supabase", async () => {
    const response = await onRequestPost({
      request: createSaveKeysRequest({
        exchanges: [
          {
            exchangeId: "kraken",
            apiKey: "plain-api-key",
            secret: "",
          },
        ],
      }),
      env,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Both apiKey and secret are required for kraken.",
    });
    expect(supabaseMocks.upsertMock).not.toHaveBeenCalled();
  });
});
