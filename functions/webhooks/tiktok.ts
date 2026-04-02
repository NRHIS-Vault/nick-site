import {
  corsHeaders,
  getRequestId,
  getSupabaseClient,
  jsonResponse,
  logWebhookEvent,
  parseJsonObject,
  parseTikTokLeadRows,
  storeSocialLeads,
  type SocialWebhookEnv,
  verifyTikTokSignature,
} from "../social-webhooks/shared";

type Env = SocialWebhookEnv;

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = () =>
  jsonResponse(
    {
      ok: false,
      error: "TikTok webhooks use POST requests only",
    },
    405
  );

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  const requestId = getRequestId(request);
  logWebhookEvent("info", "tiktok", requestId, "Received webhook request");

  if (!env?.SUPABASE_URL || !env?.SUPABASE_KEY) {
    logWebhookEvent("error", "tiktok", requestId, "Missing Supabase configuration");
    return jsonResponse(
      { ok: false, error: "Server misconfigured: missing Supabase secrets" },
      500
    );
  }

  const rawBody = await request.text();

  // Security: TikTok signs `timestamp.rawBody`. We verify the HMAC and reject requests
  // outside a short replay window so captured payloads cannot be reused later.
  const signatureResult = await verifyTikTokSignature({
    rawBody,
    headerValue: request.headers.get("TikTok-Signature"),
    appSecret: env.TIKTOK_APP_SECRET,
  });

  if (!signatureResult.ok) {
    logWebhookEvent("warn", "tiktok", requestId, "Rejected request", {
      reason: signatureResult.reason,
    });
    return jsonResponse({ ok: false, error: "Invalid TikTok webhook signature" }, 401);
  }

  let payload: Record<string, unknown> | null = null;

  try {
    payload = parseJsonObject(rawBody);
  } catch (error) {
    logWebhookEvent("warn", "tiktok", requestId, "Invalid JSON body", {
      error: error instanceof Error ? error.message : "Unknown JSON parse error",
    });
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!payload) {
    return jsonResponse({ ok: false, error: "Webhook body must be a JSON object" }, 400);
  }

  const receivedAt = new Date().toISOString();
  const rows = await parseTikTokLeadRows(payload, receivedAt);

  if (!rows.length) {
    logWebhookEvent("info", "tiktok", requestId, "No lead events found in payload", {
      event: typeof payload.event === "string" ? payload.event : null,
    });
    return jsonResponse({ ok: true, processed: 0 }, 200);
  }

  try {
    const supabase = getSupabaseClient(env);
    await storeSocialLeads(supabase, rows);
  } catch (error) {
    logWebhookEvent("error", "tiktok", requestId, "Failed to store lead rows", {
      error: error instanceof Error ? error.message : "Unknown storage error",
      processed: rows.length,
    });
    return jsonResponse({ ok: false, error: "Failed to persist lead data" }, 500);
  }

  logWebhookEvent("info", "tiktok", requestId, "Stored social leads", {
    processed: rows.length,
  });
  return jsonResponse({ ok: true, processed: rows.length }, 200);
};
