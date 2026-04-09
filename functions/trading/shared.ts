import * as ccxt from "ccxt";
import type { Exchange } from "ccxt";

export type TradingEnv = Record<string, string | undefined> & {
  TRADING_EXCHANGE_ID?: string;
  TRADING_API_KEY?: string;
  TRADING_SECRET?: string;
  TRADING_PASSWORD?: string;
  TRADING_UID?: string;
  TRADING_SANDBOX?: string;
  TRADING_DEFAULT_SYMBOL?: string;
  TRADING_TRADE_LIMIT?: string;
  BINANCE_API_KEY?: string;
  BINANCE_SECRET?: string;
  BINANCE_PASSWORD?: string;
  BINANCE_UID?: string;
  BINANCE_SANDBOX?: string;
  COINBASE_API_KEY?: string;
  COINBASE_SECRET?: string;
  COINBASE_PASSWORD?: string;
  COINBASE_UID?: string;
  COINBASE_SANDBOX?: string;
};

type ExchangeConstructor = new (config: Record<string, unknown>) => Exchange;

type CredentialConfig = {
  apiKeyName: string;
  secretName: string;
  passwordName: string;
  uidName: string;
  sandboxName: string;
  apiKey: string;
  secret: string;
  password?: string;
  uid?: string;
  sandbox: boolean;
};

export class TradingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingConfigError";
  }
}

export class TradingRequestError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TradingRequestError";
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_EXCHANGE_ID = "binance";
const truthyValues = new Set(["1", "true", "yes", "on"]);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export const jsonResponse = (
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });

export const optionsResponse = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

const trimToUndefined = (value: string | null | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const toEnvPrefix = (exchangeId: string) =>
  exchangeId.toUpperCase().replace(/[^A-Z0-9]/g, "_");

const normalizeExchangeId = (env: TradingEnv) =>
  trimToUndefined(env.TRADING_EXCHANGE_ID)?.toLowerCase() || DEFAULT_EXCHANGE_ID;

const readEnvValue = (env: TradingEnv, preferredName: string, fallbackName: string) => {
  const preferredValue = trimToUndefined(env[preferredName]);
  if (preferredValue) {
    return { name: preferredName, value: preferredValue };
  }

  const fallbackValue = trimToUndefined(env[fallbackName]);
  if (fallbackValue) {
    return { name: fallbackName, value: fallbackValue };
  }

  return {
    name: `${preferredName} or ${fallbackName}`,
    value: undefined,
  };
};

const readBooleanEnvValue = (
  env: TradingEnv,
  preferredName: string,
  fallbackName: string
) => {
  const rawValue = trimToUndefined(env[preferredName]) ?? trimToUndefined(env[fallbackName]);
  return rawValue ? truthyValues.has(rawValue.toLowerCase()) : false;
};

const readCredentials = (env: TradingEnv, exchangeId: string): CredentialConfig => {
  const prefix = toEnvPrefix(exchangeId);
  const apiKey = readEnvValue(env, `${prefix}_API_KEY`, "TRADING_API_KEY");
  const secret = readEnvValue(env, `${prefix}_SECRET`, "TRADING_SECRET");
  const password = readEnvValue(env, `${prefix}_PASSWORD`, "TRADING_PASSWORD");
  const uid = readEnvValue(env, `${prefix}_UID`, "TRADING_UID");
  const sandboxName = `${prefix}_SANDBOX`;

  if (!apiKey.value || !secret.value) {
    throw new TradingConfigError(
      `Missing exchange credentials. Set ${apiKey.name} and ${secret.name} as server-side secrets.`
    );
  }

  return {
    apiKeyName: apiKey.name,
    secretName: secret.name,
    passwordName: password.name,
    uidName: uid.name,
    sandboxName,
    apiKey: apiKey.value,
    secret: secret.value,
    password: password.value,
    uid: uid.value,
    sandbox: readBooleanEnvValue(env, sandboxName, "TRADING_SANDBOX"),
  };
};

const getExchangeConstructor = (exchangeId: string): ExchangeConstructor => {
  const ccxtModule = ccxt as unknown as Record<string, unknown> & { exchanges: string[] };
  const exchangeConstructor = ccxtModule[exchangeId];

  if (typeof exchangeConstructor !== "function" || !ccxtModule.exchanges.includes(exchangeId)) {
    throw new TradingConfigError(
      `Unsupported exchange "${exchangeId}". Set TRADING_EXCHANGE_ID to one of the exchanges supported by ccxt.`
    );
  }

  return exchangeConstructor as ExchangeConstructor;
};

export const createExchangeClient = (env: TradingEnv) => {
  const exchangeId = normalizeExchangeId(env);
  const credentials = readCredentials(env, exchangeId);
  const ExchangeClient = getExchangeConstructor(exchangeId);
  const exchangeConfig: Record<string, unknown> = {
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    enableRateLimit: true,
    options: {
      adjustForTimeDifference: true,
    },
  };

  if (credentials.password) {
    exchangeConfig.password = credentials.password;
  }

  if (credentials.uid) {
    exchangeConfig.uid = credentials.uid;
  }

  const exchange = new ExchangeClient(exchangeConfig);

  if (credentials.sandbox && typeof exchange.setSandboxMode === "function") {
    exchange.setSandboxMode(true);
  }

  return {
    exchange,
    exchangeId,
    credentialNames: {
      apiKey: credentials.apiKeyName,
      secret: credentials.secretName,
      password: credentials.passwordName,
      uid: credentials.uidName,
      sandbox: credentials.sandboxName,
    },
  };
};

export const getOptionalSymbol = (request: Request, env?: TradingEnv) => {
  const url = new URL(request.url);
  return (
    trimToUndefined(url.searchParams.get("symbol")) ??
    trimToUndefined(env?.TRADING_DEFAULT_SYMBOL)
  );
};

export const requireSymbol = (symbol: string | undefined) => {
  if (!symbol) {
    throw new TradingRequestError(
      400,
      "SYMBOL_REQUIRED",
      "Provide a market symbol with ?symbol=BTC/USDT or set TRADING_DEFAULT_SYMBOL."
    );
  }

  return symbol;
};

export const getOptionalSince = (request: Request) => {
  const url = new URL(request.url);
  const rawSince = trimToUndefined(url.searchParams.get("since"));

  if (!rawSince) {
    return undefined;
  }

  const timestamp = /^\d+$/.test(rawSince) ? Number(rawSince) : Date.parse(rawSince);

  if (!Number.isFinite(timestamp)) {
    throw new TradingRequestError(
      400,
      "INVALID_SINCE",
      "since must be a millisecond timestamp or an ISO date string."
    );
  }

  return timestamp;
};

export const getOptionalLimit = (
  request: Request,
  env: TradingEnv,
  fallback = 50,
  max = 100
) => {
  const url = new URL(request.url);
  const rawLimit =
    trimToUndefined(url.searchParams.get("limit")) ??
    trimToUndefined(env.TRADING_TRADE_LIMIT);

  if (!rawLimit) {
    return fallback;
  }

  const limit = Number(rawLimit);

  if (!Number.isFinite(limit) || limit < 1) {
    throw new TradingRequestError(
      400,
      "INVALID_LIMIT",
      "limit must be a positive number."
    );
  }

  return Math.min(Math.floor(limit), max);
};

const getSafeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown exchange error";

export const exchangeErrorResponse = (error: unknown) => {
  if (error instanceof TradingConfigError) {
    return jsonResponse({ ok: false, code: "TRADING_CONFIG_ERROR", error: error.message }, 500);
  }

  if (error instanceof TradingRequestError) {
    return jsonResponse({ ok: false, code: error.code, error: error.message }, error.status);
  }

  if (error instanceof ccxt.RateLimitExceeded || error instanceof ccxt.DDoSProtection) {
    return jsonResponse(
      {
        ok: false,
        code: "EXCHANGE_RATE_LIMITED",
        error: "The exchange rate limit was reached. Retry after a short delay.",
      },
      429,
      { "Retry-After": "60" }
    );
  }

  if (error instanceof ccxt.AuthenticationError) {
    return jsonResponse(
      {
        ok: false,
        code: "EXCHANGE_AUTHENTICATION_FAILED",
        error: "Exchange authentication failed. Check the API key and secret.",
      },
      401
    );
  }

  if (
    error instanceof ccxt.PermissionDenied ||
    error instanceof ccxt.AccountNotEnabled ||
    error instanceof ccxt.AccountSuspended
  ) {
    return jsonResponse(
      {
        ok: false,
        code: "EXCHANGE_PERMISSION_DENIED",
        error: "The exchange rejected the API key permissions or account status.",
      },
      403
    );
  }

  if (error instanceof ccxt.BadSymbol || error instanceof ccxt.NotSupported) {
    return jsonResponse(
      {
        ok: false,
        code: "EXCHANGE_BAD_REQUEST",
        error: getSafeErrorMessage(error),
      },
      400
    );
  }

  if (
    error instanceof ccxt.NetworkError ||
    error instanceof ccxt.ExchangeNotAvailable ||
    error instanceof ccxt.RequestTimeout
  ) {
    return jsonResponse(
      {
        ok: false,
        code: "EXCHANGE_UNAVAILABLE",
        error: "The exchange is unavailable or the request timed out.",
      },
      503
    );
  }

  console.error("Unhandled exchange API error", error);

  return jsonResponse(
    {
      ok: false,
      code: "EXCHANGE_REQUEST_FAILED",
      error: "Unable to fetch exchange data right now.",
    },
    502
  );
};
