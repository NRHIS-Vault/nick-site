import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SocialPlatform = "meta" | "instagram" | "tiktok";

export type SocialWebhookEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  META_APP_SECRET?: string;
  META_VERIFY_TOKEN?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_VERIFY_TOKEN?: string;
  TIKTOK_APP_SECRET?: string;
};

export type SocialLeadRow = {
  id: string;
  platform: SocialPlatform;
  campaign_id: string | null;
  lead_data: Record<string, unknown>;
  received_at: string;
};

type SignatureVerificationResult = {
  ok: boolean;
  reason?: string;
};

type TikTokSignatureParts = {
  timestamp: string;
  signature: string;
};

const encoder = new TextEncoder();

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, X-Hub-Signature, X-Hub-Signature-256, TikTok-Signature",
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

export const textResponse = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...corsHeaders,
    },
  });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asRecord = (value: unknown) => (isRecord(value) ? value : null);

export const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

export const getString = (
  record: Record<string, unknown> | null,
  ...keys: string[]
) => {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

export const getRequestId = (request: Request) =>
  request.headers.get("CF-Ray") || crypto.randomUUID();

export const logWebhookEvent = (
  level: "info" | "warn" | "error",
  platform: SocialPlatform,
  requestId: string,
  message: string,
  details: Record<string, unknown> = {}
) => {
  const payload = {
    platform,
    requestId,
    message,
    ...details,
  };

  if (level === "error") {
    console.error("[social-webhook]", payload);
    return;
  }

  if (level === "warn") {
    console.warn("[social-webhook]", payload);
    return;
  }

  console.info("[social-webhook]", payload);
};

export const getSupabaseClient = (
  env: Pick<SocialWebhookEnv, "SUPABASE_URL" | "SUPABASE_KEY">
): SupabaseClient =>
  createClient(env.SUPABASE_URL as string, env.SUPABASE_KEY as string, {
    global: { fetch: (input, init) => fetch(input, init) },
  });

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

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

  return toHex(signature);
};

const createSha256Hex = async (payload: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  return toHex(digest);
};

const safeCompare = (left: string, right: string) => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
};

const getPrefixedSignature = (headerValue: string | null, prefix: string) => {
  if (!headerValue) {
    return null;
  }

  const [rawPrefix, rawSignature] = headerValue.split("=", 2);
  if (rawPrefix?.trim().toLowerCase() !== prefix.toLowerCase()) {
    return null;
  }

  const signature = rawSignature?.trim().toLowerCase();
  return signature || null;
};

export const verifyMetaSignature = async (
  rawBody: string,
  headerValue: string | null,
  appSecret: string | undefined
): Promise<SignatureVerificationResult> => {
  if (!appSecret?.trim()) {
    return {
      ok: false,
      reason: "Missing META_APP_SECRET",
    };
  }

  const providedSignature = getPrefixedSignature(headerValue, "sha1");
  if (!providedSignature) {
    return {
      ok: false,
      reason: "Missing or malformed X-Hub-Signature header",
    };
  }

  const expectedSignature = await createHmacHex(rawBody, appSecret, "SHA-1");
  return {
    ok: safeCompare(expectedSignature, providedSignature),
    reason: safeCompare(expectedSignature, providedSignature)
      ? undefined
      : "Meta signature mismatch",
  };
};

export const verifyInstagramSignature = async (
  rawBody: string,
  headerValue: string | null,
  appSecret: string | undefined
): Promise<SignatureVerificationResult> => {
  if (!appSecret?.trim()) {
    return {
      ok: false,
      reason: "Missing INSTAGRAM_APP_SECRET",
    };
  }

  const providedSignature = getPrefixedSignature(headerValue, "sha256");
  if (!providedSignature) {
    return {
      ok: false,
      reason: "Missing or malformed X-Hub-Signature-256 header",
    };
  }

  const expectedSignature = await createHmacHex(rawBody, appSecret, "SHA-256");
  return {
    ok: safeCompare(expectedSignature, providedSignature),
    reason: safeCompare(expectedSignature, providedSignature)
      ? undefined
      : "Instagram signature mismatch",
  };
};

const parseTikTokSignature = (headerValue: string | null): TikTokSignatureParts | null => {
  if (!headerValue) {
    return null;
  }

  const pairs = headerValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split("=", 2))
    .reduce<Record<string, string>>((result, [key, value]) => {
      if (key && value) {
        result[key.trim().toLowerCase()] = value.trim().toLowerCase();
      }

      return result;
    }, {});

  if (!pairs.t || !pairs.s) {
    return null;
  }

  return {
    timestamp: pairs.t,
    signature: pairs.s,
  };
};

export const verifyTikTokSignature = async ({
  rawBody,
  headerValue,
  appSecret,
  now = Date.now(),
  toleranceSeconds = 300,
}: {
  rawBody: string;
  headerValue: string | null;
  appSecret: string | undefined;
  now?: number;
  toleranceSeconds?: number;
}): Promise<SignatureVerificationResult> => {
  if (!appSecret?.trim()) {
    return {
      ok: false,
      reason: "Missing TIKTOK_APP_SECRET",
    };
  }

  const parsedSignature = parseTikTokSignature(headerValue);
  if (!parsedSignature) {
    return {
      ok: false,
      reason: "Missing or malformed TikTok-Signature header",
    };
  }

  const timestampMs = Number(parsedSignature.timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return {
      ok: false,
      reason: "TikTok signature timestamp is invalid",
    };
  }

  const ageMs = Math.abs(now - timestampMs);
  if (ageMs > toleranceSeconds * 1000) {
    return {
      ok: false,
      reason: "TikTok signature timestamp is outside the replay window",
    };
  }

  const signedPayload = `${parsedSignature.timestamp}.${rawBody}`;
  const expectedSignature = await createHmacHex(
    signedPayload,
    appSecret,
    "SHA-256"
  );

  return {
    ok: safeCompare(expectedSignature, parsedSignature.signature),
    reason: safeCompare(expectedSignature, parsedSignature.signature)
      ? undefined
      : "TikTok signature mismatch",
  };
};

export const parseJsonObject = (rawBody: string) => {
  const parsed = JSON.parse(rawBody) as unknown;
  return asRecord(parsed);
};

const mapFieldDataArray = (value: unknown) => {
  const fields = asArray(value);
  const mappedFields = fields.reduce<Record<string, unknown>>((result, field) => {
    const fieldRecord = asRecord(field);
    const name = getString(fieldRecord, "name", "key", "question");
    if (!name) {
      return result;
    }

    const rawValue =
      fieldRecord?.values ??
      fieldRecord?.value ??
      fieldRecord?.answer ??
      fieldRecord?.answers;

    if (Array.isArray(rawValue)) {
      result[name] = rawValue.length === 1 ? rawValue[0] : rawValue;
      return result;
    }

    if (rawValue !== undefined) {
      result[name] = rawValue;
    }

    return result;
  }, {});

  return Object.keys(mappedFields).length ? mappedFields : null;
};

const pickFlatLeadFields = (value: Record<string, unknown>) => {
  const keys = [
    "name",
    "full_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "phone_number",
    "service",
    "interest",
    "company",
    "city",
    "country",
  ];

  const fields = keys.reduce<Record<string, unknown>>((result, key) => {
    const fieldValue = value[key];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== "") {
      result[key] = fieldValue;
    }

    return result;
  }, {});

  return Object.keys(fields).length ? fields : null;
};

export const extractLeadFields = (value: Record<string, unknown>) =>
  mapFieldDataArray(value.field_data) ||
  mapFieldDataArray(value.answers) ||
  mapFieldDataArray(value.questions) ||
  pickFlatLeadFields(value);

export const isLeadLikePayload = (
  value: Record<string, unknown> | null,
  field?: string | null,
  eventName?: string | null
) => {
  const normalizedField = field?.toLowerCase() || "";
  const normalizedEvent = eventName?.toLowerCase() || "";

  if (normalizedField.includes("lead") || normalizedEvent.includes("lead")) {
    return true;
  }

  if (!value) {
    return false;
  }

  const leadKeys = [
    "lead_id",
    "leadgen_id",
    "form_id",
    "campaign_id",
    "field_data",
    "answers",
    "questions",
    "email",
    "phone",
    "phone_number",
  ];

  return leadKeys.some((key) => key in value);
};

const createStoredLeadId = async (
  platform: SocialPlatform,
  providerLeadId: string | null,
  payload: Record<string, unknown>
) => {
  if (providerLeadId) {
    return `${platform}:${providerLeadId}`;
  }

  // When a provider omits a dedicated lead ID, hash the lead fragment so retries
  // collapse onto the same row rather than duplicating data.
  const fallbackDigest = await createSha256Hex(JSON.stringify(payload));
  return `${platform}:${fallbackDigest.slice(0, 40)}`;
};

const buildLeadRow = async ({
  platform,
  providerLeadId,
  campaignId,
  leadData,
  receivedAt,
}: {
  platform: SocialPlatform;
  providerLeadId: string | null;
  campaignId: string | null;
  leadData: Record<string, unknown>;
  receivedAt: string;
}): Promise<SocialLeadRow> => ({
  id: await createStoredLeadId(platform, providerLeadId, leadData),
  platform,
  campaign_id: campaignId,
  lead_data: leadData,
  received_at: receivedAt,
});

export const parseMetaLeadRows = async (
  payload: Record<string, unknown>,
  receivedAt: string
) => {
  const rows: SocialLeadRow[] = [];
  const object = getString(payload, "object");

  for (const entry of asArray(payload.entry)) {
    const entryRecord = asRecord(entry);
    const entryId = getString(entryRecord, "id");
    const entryTime = entryRecord?.time ?? null;

    for (const change of asArray(entryRecord?.changes)) {
      const changeRecord = asRecord(change);
      const field = getString(changeRecord, "field");
      const value = asRecord(changeRecord?.value);

      if (!isLeadLikePayload(value, field)) {
        continue;
      }

      const providerLeadId = getString(value, "leadgen_id", "lead_id", "id");
      const campaignId = getString(
        value,
        "campaign_id",
        "ad_id",
        "adgroup_id",
        "form_id"
      );
      const leadFields = value ? extractLeadFields(value) : null;
      const leadData = {
        object: object || "page",
        entry_id: entryId,
        entry_time: entryTime,
        field,
        lead_id: providerLeadId,
        campaign_id: campaignId,
        page_id: getString(value, "page_id"),
        form_id: getString(value, "form_id"),
        ad_id: getString(value, "ad_id"),
        adgroup_id: getString(value, "adgroup_id"),
        created_time: value?.created_time ?? entryTime,
        lead_fields: leadFields,
        raw: value || {},
      } satisfies Record<string, unknown>;

      rows.push(
        await buildLeadRow({
          platform: "meta",
          providerLeadId,
          campaignId,
          leadData,
          receivedAt,
        })
      );
    }
  }

  return rows;
};

export const parseInstagramLeadRows = async (
  payload: Record<string, unknown>,
  receivedAt: string
) => {
  const rows: SocialLeadRow[] = [];
  const object = getString(payload, "object");

  for (const entry of asArray(payload.entry)) {
    const entryRecord = asRecord(entry);
    const entryId = getString(entryRecord, "id");
    const entryTime = entryRecord?.time ?? null;

    for (const change of asArray(entryRecord?.changes)) {
      const changeRecord = asRecord(change);
      const field = getString(changeRecord, "field");
      const value = asRecord(changeRecord?.value);

      if (!isLeadLikePayload(value, field)) {
        continue;
      }

      const providerLeadId = getString(
        value,
        "lead_id",
        "leadgen_id",
        "id",
        "form_response_id"
      );
      const campaignId = getString(
        value,
        "campaign_id",
        "ad_id",
        "media_id",
        "form_id"
      );
      const leadFields = value ? extractLeadFields(value) : null;
      const leadData = {
        object: object || "instagram",
        entry_id: entryId,
        entry_time: entryTime,
        field,
        lead_id: providerLeadId,
        campaign_id: campaignId,
        form_id: getString(value, "form_id"),
        media_id: getString(value, "media_id"),
        created_time: value?.created_time ?? entryTime,
        lead_fields: leadFields,
        raw: value || {},
      } satisfies Record<string, unknown>;

      rows.push(
        await buildLeadRow({
          platform: "instagram",
          providerLeadId,
          campaignId,
          leadData,
          receivedAt,
        })
      );
    }
  }

  return rows;
};

export const parseTikTokLeadRows = async (
  payload: Record<string, unknown>,
  receivedAt: string
) => {
  const eventName = getString(payload, "event");
  const rawContent = payload.content;
  const parsedContent =
    typeof rawContent === "string"
      ? (() => {
          try {
            return JSON.parse(rawContent) as unknown;
          } catch (_error) {
            return rawContent;
          }
        })()
      : rawContent;

  const contentRecord = asRecord(parsedContent);

  if (!isLeadLikePayload(contentRecord, null, eventName)) {
    return [];
  }

  const providerLeadId = getString(
    contentRecord,
    "lead_id",
    "id",
    "form_response_id"
  );
  const campaignId = getString(
    contentRecord,
    "campaign_id",
    "campaignId",
    "ad_id",
    "form_id"
  );
  const leadFields = contentRecord ? extractLeadFields(contentRecord) : null;
  const leadData = {
    event: eventName,
    create_time: payload.create_time ?? null,
    user_openid: getString(payload, "user_openid"),
    lead_id: providerLeadId,
    campaign_id: campaignId,
    lead_fields: leadFields,
    content: parsedContent,
  } satisfies Record<string, unknown>;

  return [
    await buildLeadRow({
      platform: "tiktok",
      providerLeadId,
      campaignId,
      leadData,
      receivedAt,
    }),
  ];
};

export const storeSocialLeads = async (
  supabase: SupabaseClient,
  rows: SocialLeadRow[]
) => {
  if (!rows.length) {
    return;
  }

  const { error } = await supabase
    .from("social_leads")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    throw error;
  }
};

export const handleSubscriptionVerification = ({
  request,
  verifyToken,
  platform,
}: {
  request: Request;
  verifyToken: string | undefined;
  platform: SocialPlatform;
}) => {
  if (!verifyToken?.trim()) {
    return jsonResponse(
      {
        ok: false,
        error: `${platform} webhook is missing its verify token configuration`,
      },
      500
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const suppliedToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!mode || !suppliedToken || !challenge) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing hub.mode, hub.verify_token, or hub.challenge",
      },
      400
    );
  }

  if (mode !== "subscribe" || suppliedToken !== verifyToken) {
    return jsonResponse(
      {
        ok: false,
        error: "Webhook verification failed",
      },
      403
    );
  }

  return textResponse(challenge, 200);
};
