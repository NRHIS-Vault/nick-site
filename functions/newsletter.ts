import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cloudflare Pages Function: handle newsletter sign-ups and persist them to Supabase.
// Secrets `SUPABASE_URL` and `SUPABASE_KEY` come from Wrangler secrets and are injected
// into `env`. The handler validates the payload, writes to the `newsletter_subscribers`
// table, and responds with JSON plus CORS headers.

type Env = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
};

type NewsletterPayload = {
  email: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const getSupabaseClient = (env: Env): SupabaseClient =>
  createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
    global: { fetch: (input, init) => fetch(input, init) },
  });

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  // Step 1: verify secrets exist so the handler fails loudly if misconfigured.
  if (!env?.SUPABASE_URL || !env?.SUPABASE_KEY) {
    return jsonResponse(
      { ok: false, error: "Server misconfigured: missing Supabase secrets" },
      500
    );
  }

  // Step 2: parse and validate the incoming JSON payload.
  let payload: Partial<NewsletterPayload>;

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const email = payload.email?.trim().toLowerCase();

  if (!email) {
    return jsonResponse({ ok: false, error: "Email is required" }, 400);
  }

  if (!emailPattern.test(email)) {
    return jsonResponse({ ok: false, error: "Invalid email address" }, 400);
  }

  // Step 3: persist the subscriber to Supabase with a case-insensitive unique email index.
  const supabase = getSupabaseClient(env);

  const { error } = await supabase
    .from("newsletter_subscribers")
    .insert({ email });

  if (error) {
    // Handle duplicate sign-ups and generic failures separately for clearer UX.
    const duplicate =
      error.code === "23505" ||
      (typeof error.message === "string" &&
        error.message.toLowerCase().includes("duplicate"));

    if (duplicate) {
      return jsonResponse({
        ok: true,
        message: "You're already subscribed.",
      });
    }

    console.error("Failed to save newsletter subscription", error);
    return jsonResponse(
      { ok: false, error: "Unable to save subscription right now" },
      500
    );
  }

  return jsonResponse({
    ok: true,
    message: "Thanks for subscribing. You're on the list!",
  });
};
