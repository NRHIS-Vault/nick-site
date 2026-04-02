import {
  corsHeaders,
  getRequestId,
  getSupabaseClient,
  handleSubscriptionVerification,
  jsonResponse,
  logWebhookEvent,
  parseJsonObject,
  parseMetaLeadRows,
  storeSocialLeads,
  type SocialWebhookEnv,
  verifyMetaSignature,
} from "../social-webhooks/shared";

type Env = SocialWebhookEnv;

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => handleSubscriptionVerification({
  request,
  verifyToken: env.META_VERIFY_TOKEN,
  platform: "meta",
});

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  const requestId = getRequestId(request);
  logWebhookEvent("info", "meta", requestId, "Received webhook request");

  if (!env?.SUPABASE_URL || !env?.SUPABASE_KEY) {
    logWebhookEvent("error", "meta", requestId, "Missing Supabase configuration");
    return jsonResponse(
      { ok: false, error: "Server misconfigured: missing Supabase secrets" },
      500
    );
  }

  const rawBody = await request.text();

  // Security: verify the HMAC against the exact raw request body before JSON parsing so
  // tampered payloads never reach the database layer.
  const signatureResult = await verifyMetaSignature(
    rawBody,
    request.headers.get("X-Hub-Signature"),
    env.META_APP_SECRET
  );

  if (!signatureResult.ok) {
    logWebhookEvent("warn", "meta", requestId, "Rejected request", {
      reason: signatureResult.reason,
    });
    return jsonResponse({ ok: false, error: "Invalid Meta webhook signature" }, 401);
  }

  let payload: Record<string, unknown> | null = null;

  try {
    payload = parseJsonObject(rawBody);
  } catch (error) {
    logWebhookEvent("warn", "meta", requestId, "Invalid JSON body", {
      error: error instanceof Error ? error.message : "Unknown JSON parse error",
    });
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!payload) {
    return jsonResponse({ ok: false, error: "Webhook body must be a JSON object" }, 400);
  }

  const receivedAt = new Date().toISOString();
  const rows = await parseMetaLeadRows(payload, receivedAt);

  if (!rows.length) {
    logWebhookEvent("info", "meta", requestId, "No lead events found in payload");
    return jsonResponse({ ok: true, processed: 0 }, 200);
  }

  try {
    // Security: the service-role key stays server-side in Cloudflare env vars; only
    // normalized records are written and duplicate deliveries collapse via upsert.
    const supabase = getSupabaseClient(env);
    await storeSocialLeads(supabase, rows);
  } catch (error) {
    logWebhookEvent("error", "meta", requestId, "Failed to store lead rows", {
      error: error instanceof Error ? error.message : "Unknown storage error",
      processed: rows.length,
    });
    return jsonResponse({ ok: false, error: "Failed to persist lead data" }, 500);
  }

  logWebhookEvent("info", "meta", requestId, "Stored social leads", {
    processed: rows.length,
  });
  return jsonResponse({ ok: true, processed: rows.length }, 200);
};
