import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type TradingActionAuthEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
};

type TradingProfileRecord = {
  role?: string | null;
};

export type TradingActionRole = "admin" | "paid";

export class TradingAuthorizationError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TradingAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;
const ALLOWED_TRADING_ACTION_ROLES = new Set<TradingActionRole>(["admin", "paid"]);

const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toMetadataRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const createSupabaseServerClient = (env: TradingActionAuthEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new TradingAuthorizationError(
      500,
      "TRADING_AUTH_MISCONFIGURED",
      "Server misconfigured: missing Supabase secrets for trading authorization."
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    global: {
      fetch: (input, init) => fetch(input, init),
    },
  });
};

const getBearerToken = (request: Request) => {
  const authorizationHeader =
    request.headers.get("Authorization") || request.headers.get("authorization");

  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(BEARER_TOKEN_PATTERN);
  return match?.[1]?.trim() || null;
};

const resolveTradingRole = (user: User, profile: TradingProfileRecord | null) => {
  const userMetadata = toMetadataRecord(user.user_metadata);
  const appMetadata = toMetadataRecord(user.app_metadata);

  return (
    readString(profile?.role) ??
    readString(appMetadata.role) ??
    readString(userMetadata.role)
  )?.toLowerCase() ?? null;
};

export const requireTradingActionRole = async (
  request: Request,
  env: TradingActionAuthEnv
) => {
  const token = getBearerToken(request);
  if (!token) {
    throw new TradingAuthorizationError(
      401,
      "TRADING_AUTH_REQUIRED",
      "Missing Authorization bearer token."
    );
  }

  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new TradingAuthorizationError(
      401,
      "TRADING_AUTH_INVALID",
      "Invalid or expired Supabase access token."
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    throw new TradingAuthorizationError(
      500,
      "TRADING_PROFILE_LOOKUP_FAILED",
      "Unable to load the user authorization profile."
    );
  }

  const role = resolveTradingRole(data.user, (profile as TradingProfileRecord | null) ?? null);

  // Risk control: trade execution is not tied to generic "logged in" or "active subscription"
  // state. Mutating exchange state requires an explicit elevated trading role so basic dashboard
  // access does not automatically imply permission to place or cancel live orders.
  if (!role || !ALLOWED_TRADING_ACTION_ROLES.has(role as TradingActionRole)) {
    throw new TradingAuthorizationError(
      403,
      "TRADING_ACTION_FORBIDDEN",
      "Trading actions require a paid or admin role."
    );
  }

  return {
    user: data.user,
    role: role as TradingActionRole,
  };
};
