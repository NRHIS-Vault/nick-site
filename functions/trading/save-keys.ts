import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type TradingKeyStorageEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  TRADING_KEYS_ENCRYPTION_KEY?: string;
};

const SUPPORTED_EXCHANGE_IDS = ["binance", "coinbase", "kraken", "kucoin", "okx"] as const;

type SupportedExchangeId = (typeof SUPPORTED_EXCHANGE_IDS)[number];

type TradingKeyCredential = {
  exchangeId: SupportedExchangeId;
  apiKey: string;
  secret: string;
};

type EncryptedValue = {
  ciphertext: string;
  iv: string;
};

const supportedExchangeIds = new Set<string>(SUPPORTED_EXCHANGE_IDS);
const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;
const MAX_SECRET_LENGTH = 4096;
const ENCRYPTION_ALGORITHM = "AES-GCM";
const ENCRYPTION_KEY_VERSION = "v1";
const encoder = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

class TradingKeyStorageError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TradingKeyStorageError";
    this.status = status;
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readTrimmedString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const createSupabaseServerClient = (env: TradingKeyStorageEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new TradingKeyStorageError(
      500,
      "Server misconfigured: missing Supabase secrets for trading key storage."
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

const requireAuthenticatedUser = async (
  request: Request,
  supabase: SupabaseClient
) => {
  const token = getBearerToken(request);
  if (!token) {
    throw new TradingKeyStorageError(401, "Missing Authorization bearer token.");
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new TradingKeyStorageError(401, "Invalid or expired Supabase access token.");
  }

  return data.user;
};

const parseExchangeId = (value: unknown) => {
  const exchangeId = readTrimmedString(value).toLowerCase();
  return supportedExchangeIds.has(exchangeId) ? (exchangeId as SupportedExchangeId) : null;
};

const parseCredentials = (payload: unknown): TradingKeyCredential[] => {
  if (!isRecord(payload) || !Array.isArray(payload.exchanges)) {
    throw new TradingKeyStorageError(400, "Request body must include an exchanges array.");
  }

  const seenExchangeIds = new Set<SupportedExchangeId>();
  const credentials: TradingKeyCredential[] = [];

  for (const rawExchange of payload.exchanges) {
    if (!isRecord(rawExchange)) {
      throw new TradingKeyStorageError(400, "Each exchange entry must be an object.");
    }

    const exchangeId = parseExchangeId(rawExchange.exchangeId);
    if (!exchangeId) {
      throw new TradingKeyStorageError(
        400,
        `Unsupported exchange. Use one of: ${SUPPORTED_EXCHANGE_IDS.join(", ")}.`
      );
    }

    if (seenExchangeIds.has(exchangeId)) {
      throw new TradingKeyStorageError(400, `Duplicate credentials for ${exchangeId}.`);
    }
    seenExchangeIds.add(exchangeId);

    const apiKey = readTrimmedString(rawExchange.apiKey);
    const secret = readTrimmedString(rawExchange.secret);

    if (!apiKey && !secret) {
      continue;
    }

    if (!apiKey || !secret) {
      throw new TradingKeyStorageError(
        400,
        `Both apiKey and secret are required for ${exchangeId}.`
      );
    }

    if (apiKey.length > MAX_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH) {
      throw new TradingKeyStorageError(
        400,
        `Credentials for ${exchangeId} exceed the ${MAX_SECRET_LENGTH} character limit.`
      );
    }

    credentials.push({
      exchangeId,
      apiKey,
      secret,
    });
  }

  if (!credentials.length) {
    throw new TradingKeyStorageError(400, "Provide at least one complete exchange credential pair.");
  }

  return credentials;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
};

const getEncryptionKey = async (env: TradingKeyStorageEnv) => {
  const encryptionSecret = trimToNull(env.TRADING_KEYS_ENCRYPTION_KEY);

  if (!encryptionSecret || encryptionSecret.length < 32) {
    throw new TradingKeyStorageError(
      500,
      "Server misconfigured: TRADING_KEYS_ENCRYPTION_KEY must be at least 32 characters."
    );
  }

  // Derive a stable 256-bit AES key from the worker secret. Keep the original secret
  // outside the database; losing it means stored exchange credentials cannot be recovered.
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));

  return crypto.subtle.importKey("raw", keyMaterial, ENCRYPTION_ALGORITHM, false, ["encrypt"]);
};

const encryptValue = async (key: CryptoKey, value: string): Promise<EncryptedValue> => {
  // AES-GCM needs a fresh 96-bit IV per encrypted field. The IV is safe to store
  // beside the ciphertext, but it must never be reused with the same key and plaintext.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv,
    },
    key,
    encoder.encode(value)
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
};

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
  env: TradingKeyStorageEnv;
}) => {
  try {
    const supabase = createSupabaseServerClient(env);
    const user = await requireAuthenticatedUser(request, supabase);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch (_error) {
      throw new TradingKeyStorageError(400, "Invalid JSON body.");
    }

    const credentials = parseCredentials(payload);
    const encryptionKey = await getEncryptionKey(env);
    const timestamp = new Date().toISOString();

    const rows = await Promise.all(
      credentials.map(async (credential) => {
        const [encryptedApiKey, encryptedSecret] = await Promise.all([
          encryptValue(encryptionKey, credential.apiKey),
          encryptValue(encryptionKey, credential.secret),
        ]);

        // Do not return or log these encrypted rows. Even ciphertext is treated as
        // sensitive operational data and is only written to Supabase.
        return {
          user_id: user.id,
          exchange_id: credential.exchangeId,
          api_key_ciphertext: encryptedApiKey.ciphertext,
          api_key_iv: encryptedApiKey.iv,
          secret_ciphertext: encryptedSecret.ciphertext,
          secret_iv: encryptedSecret.iv,
          encryption_algorithm: ENCRYPTION_ALGORITHM,
          key_version: ENCRYPTION_KEY_VERSION,
          updated_at: timestamp,
        };
      })
    );

    const { error } = await supabase
      .from("exchange_keys")
      .upsert(rows, { onConflict: "user_id,exchange_id" });

    if (error) {
      throw new TradingKeyStorageError(500, "Unable to save encrypted exchange credentials.");
    }

    return jsonResponse({
      ok: true,
      saved: credentials.map((credential) => credential.exchangeId),
      message: "Exchange credentials were encrypted and saved.",
    });
  } catch (error) {
    if (error instanceof TradingKeyStorageError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    console.error(
      "Failed to save encrypted trading keys",
      error instanceof Error ? error.message : error
    );
    return jsonResponse(
      { ok: false, error: "Unable to save exchange credentials right now." },
      500
    );
  }
};
