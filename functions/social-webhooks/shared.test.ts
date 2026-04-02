import { describe, expect, it } from "vitest";
import {
  parseInstagramLeadRows,
  parseMetaLeadRows,
  parseTikTokLeadRows,
  verifyInstagramSignature,
  verifyMetaSignature,
  verifyTikTokSignature,
} from "./shared";

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

describe("functions/social-webhooks/shared.ts", () => {
  it("validates the Meta X-Hub-Signature header against the raw body", async () => {
    const rawBody = JSON.stringify({
      object: "page",
      entry: [],
    });
    const secret = "meta-secret";
    const digest = await createHmacHex(rawBody, secret, "SHA-1");

    await expect(
      verifyMetaSignature(rawBody, `sha1=${digest}`, secret)
    ).resolves.toMatchObject({ ok: true });

    await expect(
      verifyMetaSignature(rawBody, "sha1=deadbeef", secret)
    ).resolves.toMatchObject({ ok: false });
  });

  it("validates the Instagram X-Hub-Signature-256 header", async () => {
    const rawBody = JSON.stringify({
      object: "instagram",
      entry: [],
    });
    const secret = "instagram-secret";
    const digest = await createHmacHex(rawBody, secret, "SHA-256");

    await expect(
      verifyInstagramSignature(rawBody, `sha256=${digest}`, secret)
    ).resolves.toMatchObject({ ok: true });
  });

  it("validates TikTok signatures and rejects stale timestamps", async () => {
    const rawBody = JSON.stringify({
      event: "lead.form.submitted",
      content: "{\"lead_id\":\"lead-1\"}",
    });
    const secret = "tiktok-secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = await createHmacHex(`${timestamp}.${rawBody}`, secret, "SHA-256");

    await expect(
      verifyTikTokSignature({
        rawBody,
        headerValue: `t=${timestamp},s=${digest}`,
        appSecret: secret,
      })
    ).resolves.toMatchObject({ ok: true });

    await expect(
      verifyTikTokSignature({
        rawBody,
        headerValue: `t=1,s=${digest}`,
        appSecret: secret,
        now: Date.now(),
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("replay window"),
    });
  });

  it("parses Meta leadgen changes into social lead rows", async () => {
    const rows = await parseMetaLeadRows(
      {
        object: "page",
        entry: [
          {
            id: "page-1",
            time: 1_711_000_000,
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: "lead-123",
                  form_id: "form-1",
                  ad_id: "campaign-1",
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
      },
      "2026-04-01T00:00:00.000Z"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "meta:lead-123",
      platform: "meta",
      campaign_id: "campaign-1",
    });
    expect(rows[0].lead_data.lead_fields).toMatchObject({
      email: "lead@example.com",
    });
  });

  it("parses Instagram lead-like changes into social lead rows", async () => {
    const rows = await parseInstagramLeadRows(
      {
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
                      values: ["555-1234"],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      "2026-04-01T00:00:00.000Z"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "instagram:ig-lead-1",
      platform: "instagram",
      campaign_id: "ig-campaign-1",
    });
    expect(rows[0].lead_data.lead_fields).toMatchObject({
      phone_number: "555-1234",
    });
  });

  it("parses TikTok lead events from JSON content strings", async () => {
    const rows = await parseTikTokLeadRows(
      {
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
      },
      "2026-04-01T00:00:00.000Z"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "tiktok:tt-lead-1",
      platform: "tiktok",
      campaign_id: "tt-campaign-1",
    });
    expect(rows[0].lead_data.lead_fields).toMatchObject({
      email: "lead@example.com",
    });
  });
});
