import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cloudflare Pages Function: handle contact form submissions and persist them to Supabase.
// Secrets `SUPABASE_URL` and `SUPABASE_KEY` are set via `wrangler secret put ...` and
// injected into the `env` object at runtime. The handler validates the payload, writes
// a row to the `messages` table, and returns a JSON result with CORS headers.

type Env = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
};

type ContactPayload = {
  name: string;
  email: string;
  message: string;
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
  // Respond to preflight requests so browsers can send JSON safely.
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
  // Step 1: ensure secrets are present; misconfiguration should fail fast.
  if (!env?.SUPABASE_URL || !env?.SUPABASE_KEY) {
    return jsonResponse(
      { ok: false, error: "Server misconfigured: missing Supabase secrets" },
      500
    );
  }

  // Step 2: parse and validate the incoming JSON payload.
  let payload: Partial<ContactPayload>;

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const name = payload.name?.trim();
  const email = payload.email?.trim().toLowerCase();
  const message = payload.message?.trim();

  if (!name || !email || !message) {
    return jsonResponse(
      { ok: false, error: "Missing name, email, or message" },
      400
    );
  }

  if (!emailPattern.test(email)) {
    return jsonResponse({ ok: false, error: "Invalid email address" }, 400);
  }

  if (message.length > 5000) {
    return jsonResponse(
      { ok: false, error: "Message is too long (limit 5,000 characters)" },
      400
    );
  }

  // Step 3: insert the message into Supabase. The service role key is used server-side only.
  const supabase = getSupabaseClient(env);

  const { error } = await supabase.from("messages").insert({
    name,
    email,
    message,
  });

  if (error) {
    console.error("Failed to save contact submission", error);
    return jsonResponse(
      { ok: false, error: "Unable to save message right now" },
      500
    );
  }

  return jsonResponse({
    ok: true,
    message: "Thanks for reaching out. We'll get back to you shortly.",
  });
};
