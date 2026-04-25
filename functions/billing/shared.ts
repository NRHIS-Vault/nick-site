import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadPlans, type CustomerPortalEnv, type PortalPlan } from "../customerPortal/shared";

export type BillingEnv = CustomerPortalEnv & {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  STRIPE_SECRET_KEY?: string;
};

export type StripeCheckoutSession = {
  id?: string;
  url?: string;
  mode?: string | null;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  customer_email?: string | null;
  customer_details?: {
    email?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
};

export class BillingRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BillingRequestError";
    this.status = status;
    this.code = code;
  }
}

const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

export const optionsResponse = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const readString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const readJsonBody = async (request: Request) => {
  try {
    const payload = await request.json();
    return readRecord(payload);
  } catch (_error) {
    throw new BillingRequestError(400, "BILLING_INVALID_JSON", "Invalid JSON body.");
  }
};

export const parseAbsoluteHttpUrl = (value: string | null, fieldName: string) => {
  if (!value) {
    throw new BillingRequestError(
      400,
      "BILLING_INVALID_REDIRECT",
      `Missing ${fieldName}.`
    );
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch (_error) {
    throw new BillingRequestError(
      400,
      "BILLING_INVALID_REDIRECT",
      `${fieldName} must be a valid absolute URL.`
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BillingRequestError(
      400,
      "BILLING_INVALID_REDIRECT",
      `${fieldName} must use http or https.`
    );
  }

  return url;
};

const createSupabaseServerClient = (env: BillingEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new BillingRequestError(
      500,
      "BILLING_SUPABASE_MISCONFIGURED",
      "Server misconfigured: missing Supabase secrets for billing."
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (input, init) => fetch(input, init),
    },
  });
};

export const requireAuthenticatedUser = async (
  request: Request,
  env: BillingEnv
): Promise<{
  supabase: SupabaseClient;
  user: User;
}> => {
  const authorizationHeader =
    request.headers.get("Authorization") || request.headers.get("authorization");
  const token = authorizationHeader?.match(BEARER_TOKEN_PATTERN)?.[1]?.trim() ?? null;

  if (!token) {
    throw new BillingRequestError(
      401,
      "BILLING_AUTH_REQUIRED",
      "Missing Authorization bearer token."
    );
  }

  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new BillingRequestError(
      401,
      "BILLING_AUTH_INVALID",
      "Invalid or expired Supabase access token."
    );
  }

  return {
    supabase,
    user: data.user,
  };
};

export const loadCheckoutPlan = async (
  env: BillingEnv,
  requestedPlanId: string | null
): Promise<PortalPlan> => {
  const { plans } = await loadPlans(env);

  const plan = requestedPlanId
    ? plans.find((candidate) => candidate.id === requestedPlanId) ?? null
    : plans.find((candidate) => candidate.popular) ?? plans[0] ?? null;

  if (!plan) {
    throw new BillingRequestError(
      503,
      "BILLING_PLAN_UNAVAILABLE",
      "No subscription plan is currently available for checkout."
    );
  }

  if (requestedPlanId && plan.id !== requestedPlanId) {
    throw new BillingRequestError(
      404,
      "BILLING_PLAN_NOT_FOUND",
      `Plan "${requestedPlanId}" is not available for checkout.`
    );
  }

  if (!Number.isFinite(plan.price) || plan.price <= 0) {
    throw new BillingRequestError(
      500,
      "BILLING_PLAN_INVALID",
      `Plan "${plan.name}" is missing a valid recurring price.`
    );
  }

  return plan;
};

type StripeRequestOptions = {
  method?: "GET" | "POST";
  bodyEntries?: Array<[string, string]>;
};

export const stripeRequest = async <T>(
  env: BillingEnv,
  path: string,
  { method = "GET", bodyEntries = [] }: StripeRequestOptions = {}
): Promise<T> => {
  const stripeSecret = trimToNull(env.STRIPE_SECRET_KEY);

  if (!stripeSecret) {
    throw new BillingRequestError(
      500,
      "BILLING_STRIPE_MISCONFIGURED",
      "Server misconfigured: missing STRIPE_SECRET_KEY."
    );
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      ...(method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    ...(method === "POST"
      ? { body: new URLSearchParams(bodyEntries).toString() }
      : {}),
  });

  const rawBody = await response.text().catch(() => "");
  const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      readString(parsedBody.error && readRecord(parsedBody.error).message) ??
      `Stripe request failed with ${response.status} ${response.statusText}.`;

    throw new BillingRequestError(502, "STRIPE_REQUEST_FAILED", message);
  }

  return parsedBody as T;
};

export const billingErrorResponse = (error: unknown) => {
  if (error instanceof BillingRequestError) {
    return jsonResponse(
      {
        ok: false,
        code: error.code,
        error: error.message,
      },
      error.status
    );
  }

  return jsonResponse(
    {
      ok: false,
      code: "BILLING_UNEXPECTED_ERROR",
      error: "Billing request failed unexpectedly.",
    },
    500
  );
};
