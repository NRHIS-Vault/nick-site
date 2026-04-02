import {
  corsHeaders,
  getRequestId,
  getSupabaseClient,
  handleSubscriptionVerification,
  jsonResponse,
  logWebhookEvent,
  parseInstagramLeadRows,
  parseJsonObject,
  storeSocialLeads,
  type SocialWebhookEnv,
  verifyInstagramSignature,
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
  verifyToken: env.INSTAGRAM_VERIFY_TOKEN,
  platform: "instagram",
});

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  const requestId = getRequestId(request);
  logWebhookEvent("info", "instagram", requestId, "Received webhook request");

  if (!env?.SUPABASE_URL || !env?.SUPABASE_KEY) {
    logWebhookEvent("error", "instagram", requestId, "Missing Supabase configuration");
    return jsonResponse(
      { ok: false, error: "Server misconfigured: missing Supabase secrets" },
      500
    );
  }

  const rawBody = await request.text();

  // Security: Instagram signs the raw body with the app secret. Validation happens before
  // parsing so modified requests are rejected and never reach application logic.
  const signatureResult = await verifyInstagramSignature(
    rawBody,
    request.headers.get("X-Hub-Signature-256"),
    env.INSTAGRAM_APP_SECRET
  );

  if (!signatureResult.ok) {
    logWebhookEvent("warn", "instagram", requestId, "Rejected request", {
      reason: signatureResult.reason,
    });
    return jsonResponse(
      { ok: false, error: "Invalid Instagram webhook signature" },
      401
    );
  }

  let payload: Record<string, unknown> | null = null;

  try {
    payload = parseJsonObject(rawBody);
  } catch (error) {
    logWebhookEvent("warn", "instagram", requestId, "Invalid JSON body", {
      error: error instanceof Error ? error.message : "Unknown JSON parse error",
    });
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!payload) {
    return jsonResponse({ ok: false, error: "Webhook body must be a JSON object" }, 400);
  }

  const receivedAt = new Date().toISOString();
  const rows = await parseInstagramLeadRows(payload, receivedAt);

  if (!rows.length) {
    logWebhookEvent("info", "instagram", requestId, "No lead events found in payload");
    return jsonResponse({ ok: true, processed: 0 }, 200);
  }

  try {
    const supabase = getSupabaseClient(env);
    await storeSocialLeads(supabase, rows);
  } catch (error) {
    logWebhookEvent("error", "instagram", requestId, "Failed to store lead rows", {
      error: error instanceof Error ? error.message : "Unknown storage error",
      processed: rows.length,
    });
    return jsonResponse({ ok: false, error: "Failed to persist lead data" }, 500);
  }

  logWebhookEvent("info", "instagram", requestId, "Stored social leads", {
    processed: rows.length,
  });
  return jsonResponse({ ok: true, processed: rows.length }, 200);
};
