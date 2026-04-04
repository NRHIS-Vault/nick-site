import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { onRequestPost as onInstagramWebhookPost } from "./instagram";
import { onRequestPost as onMetaWebhookPost } from "./meta";
import { onRequestPost as onTikTokWebhookPost } from "./tiktok";

const encoder = new TextEncoder();

const createHmacHex = async (
  payload: string,
  secret: string,
  hash: "SHA-1" | "SHA-256"
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const createWebhookRequest = (
  url: string,
  rawBody: string,
  headers: Record<string, string>
) =>
  new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: rawBody,
  });

describe("social webhook POST handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));

    supabaseMocks.upsertMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.createClientMock.mockReset();

    supabaseMocks.upsertMock.mockResolvedValue({ error: null });
    supabaseMocks.fromMock.mockReturnValue({
      upsert: supabaseMocks.upsertMock,
    });
    supabaseMocks.createClientMock.mockReturnValue({
      from: supabaseMocks.fromMock,
    });

    // These handlers log on both success and rejection paths; silence the noise so
    // the tests focus on the stored rows and HTTP responses.
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accepts a signed Meta webhook and upserts the normalized lead row", async () => {
    const rawBody = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "page-1",
          time: 1_711_000_000,
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "meta-lead-1",
                ad_id: "meta-campaign-1",
                form_id: "meta-form-1",
                field_data: [
                  {
                    name: "email",
                    values: ["lead@example.com"],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const digest = await createHmacHex(rawBody, "meta-secret", "SHA-1");

    const response = await onMetaWebhookPost({
      request: createWebhookRequest("https://example.com/webhooks/meta", rawBody, {
        "X-Hub-Signature": `sha1=${digest}`,
      }),
      env: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_KEY: "service-role-key",
        META_APP_SECRET: "meta-secret",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: 1,
    });
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("social_leads");
    expect(supabaseMocks.upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "meta:meta-lead-1",
          platform: "meta",
          campaign_id: "meta-campaign-1",
          lead_data: expect.objectContaining({
            form_id: "meta-form-1",
            lead_fields: {
              email: "lead@example.com",
            },
          }),
        }),
      ],
      { onConflict: "id" }
    );
  });

  it("rejects Meta webhook requests with invalid signatures before touching Supabase", async () => {
    const rawBody = JSON.stringify({
      object: "page",
      entry: [],
    });

    const response = await onMetaWebhookPost({
      request: createWebhookRequest("https://example.com/webhooks/meta", rawBody, {
        "X-Hub-Signature": "sha1=deadbeef",
      }),
      env: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_KEY: "service-role-key",
        META_APP_SECRET: "meta-secret",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid Meta webhook signature",
    });
    expect(supabaseMocks.createClientMock).not.toHaveBeenCalled();
    expect(supabaseMocks.upsertMock).not.toHaveBeenCalled();
  });

  it("accepts a signed Instagram webhook and stores the parsed lead row", async () => {
    const rawBody = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "ig-account-1",
          time: 1_711_000_123,
          changes: [
            {
              field: "leadgen",
              value: {
                lead_id: "ig-lead-1",
                campaign_id: "ig-campaign-1",
                field_data: [
                  {
                    name: "phone_number",
                    values: ["555-0201"],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const digest = await createHmacHex(rawBody, "instagram-secret", "SHA-256");

    const response = await onInstagramWebhookPost({
      request: createWebhookRequest(
        "https://example.com/webhooks/instagram",
        rawBody,
        {
          "X-Hub-Signature-256": `sha256=${digest}`,
        }
      ),
      env: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_KEY: "service-role-key",
        INSTAGRAM_APP_SECRET: "instagram-secret",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: 1,
    });
    expect(supabaseMocks.upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "instagram:ig-lead-1",
          platform: "instagram",
          campaign_id: "ig-campaign-1",
          lead_data: expect.objectContaining({
            lead_fields: {
              phone_number: "555-0201",
            },
          }),
        }),
      ],
      { onConflict: "id" }
    );
  });

  it("rejects Instagram webhook requests with invalid signatures", async () => {
    const rawBody = JSON.stringify({
      object: "instagram",
      entry: [],
    });

    const response = await onInstagramWebhookPost({
      request: createWebhookRequest(
        "https://example.com/webhooks/instagram",
        rawBody,
        {
          "X-Hub-Signature-256": "sha256=deadbeef",
        }
      ),
      env: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_KEY: "service-role-key",
        INSTAGRAM_APP_SECRET: "instagram-secret",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid Instagram webhook signature",
    });
    expect(supabaseMocks.createClientMock).not.toHaveBeenCalled();
    expect(supabaseMocks.upsertMock).not.toHaveBeenCalled();
  });

  it("accepts a signed TikTok webhook and upserts the normalized lead event", async () => {
    const rawBody = JSON.stringify({
      event: "lead.form.submitted",
      create_time: 1_711_000_456,
      user_openid: "user-1",
      content: JSON.stringify({
        lead_id: "tt-lead-1",
        campaign_id: "tt-campaign-1",
        answers: [
          {
            question: "email",
            answer: "lead@example.com",
          },
        ],
      }),
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = await createHmacHex(
      `${timestamp}.${rawBody}`,
      "tiktok-secret",
      "SHA-256"
    );

    const response = await onTikTokWebhookPost({
      request: createWebhookRequest("https://example.com/webhooks/tiktok", rawBody, {
        "TikTok-Signature": `t=${timestamp},s=${digest}`,
      }),
      env: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_KEY: "service-role-key",
        TIKTOK_APP_SECRET: "tiktok-secret",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: 1,
    });
    expect(supabaseMocks.upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "tiktok:tt-lead-1",
          platform: "tiktok",
          campaign_id: "tt-campaign-1",
          lead_data: expect.objectContaining({
            event: "lead.form.submitted",
            lead_fields: {
              email: "lead@example.com",
            },
          }),
        }),
      ],
      { onConflict: "id" }
    );
  });

  it("rejects TikTok webhook requests with invalid signatures", async () => {
    const rawBody = JSON.stringify({
      event: "lead.form.submitted",
      content: "{}",
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await onTikTokWebhookPost({
      request: createWebhookRequest("https://example.com/webhooks/tiktok", rawBody, {
        "TikTok-Signature": `t=${timestamp},s=deadbeef`,
      }),
      env: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_KEY: "service-role-key",
        TIKTOK_APP_SECRET: "tiktok-secret",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid TikTok webhook signature",
    });
    expect(supabaseMocks.createClientMock).not.toHaveBeenCalled();
    expect(supabaseMocks.upsertMock).not.toHaveBeenCalled();
  });
});
