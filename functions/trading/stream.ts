import type { TradingEnv } from "./shared";

type TradingStreamEnv = TradingEnv & {
  BINANCE_API_KEY?: string;
  BINANCE_SECRET?: string;
  BINANCE_SANDBOX?: string;
  COINBASE_API_KEY?: string;
  COINBASE_SECRET?: string;
};

type TradingProviderId = "binance" | "coinbase";
type ConnectionScope = "market" | "account";
type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "disconnected";

type NormalizedSymbol = {
  input: string;
  base: string;
  quote: string;
  display: string;
  binance: string;
  coinbase: string;
};

type TradingBalanceEvent = {
  id: string;
  exchange: string;
  provider: TradingProviderId;
  asset: string;
  currency: string;
  totalBalance: number;
  availableBalance: number;
  lockedBalance: number;
  change: number | null;
  timestamp: string;
};

type TradingTradeEvent = {
  id: string;
  pair: string;
  type: "BUY" | "SELL";
  amount: number;
  price: number;
  profit: number;
  timestamp: string;
  status: "OPEN" | "CLOSED" | "PENDING";
  exchange: string;
  provider: TradingProviderId;
  marketPrice?: number;
  fee?: number;
};

type TradingSignalEvent = {
  pair: string;
  direction: "UP" | "DOWN";
  strength: number;
  confidence: number;
  timeframe: string;
  exchange: string;
  provider: TradingProviderId;
  price: number;
  changePct: number;
  bid: number | null;
  ask: number | null;
  timestamp: string;
};

type ProviderStatusEvent = {
  provider: TradingProviderId;
  exchange: string;
  scope: ConnectionScope;
  status: ConnectionStatus;
  message: string;
  reconnectAttempt: number;
  timestamp: string;
  subscribedSymbols: string[];
};

type StreamErrorEvent = {
  provider?: TradingProviderId;
  exchange?: string;
  scope?: ConnectionScope | "stream";
  message: string;
  recoverable: boolean;
  timestamp: string;
};

type StreamContext = {
  env: TradingStreamEnv;
  request: Request;
  symbols: NormalizedSymbol[];
  providers: TradingProviderId[];
  safeEnqueue: (payload: {
    event?: string;
    data?: unknown;
    id?: string;
    retry?: number;
  }) => void;
  emitProviderStatus: (
    provider: TradingProviderId,
    exchange: string,
    scope: ConnectionScope,
    status: ConnectionStatus,
    message: string,
    reconnectAttempt: number
  ) => void;
  emitStreamError: (payload: StreamErrorEvent) => void;
  registerCleanup: (cleanup: () => void | Promise<void>) => void;
  isClosed: () => boolean;
};

type ManagedSocket = {
  close: () => void | Promise<void>;
};

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_RETRY_MS = 3_000;
const RECONNECT_BASE_MS = 1_500;
const RECONNECT_MAX_MS = 20_000;
const BINANCE_LISTEN_KEY_REFRESH_MS = 30 * 60 * 1000;
const MAX_SYMBOLS = 8;
const DEFAULT_PROVIDERS: TradingProviderId[] = ["binance", "coinbase"];
const DEFAULT_SYMBOLS = ["BTC/USDT", "ETH/USD"];
const STABLE_VALUE_ASSETS = new Set(["USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD"]);
const SUPPORTED_QUOTES = [
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "TUSD",
  "USDS",
  "USD",
  "BTC",
  "ETH",
  "EUR",
  "GBP",
  "TRY",
  "BRL",
  "AUD",
  "CAD",
  "JPY",
];

const encoder = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Cache-Control, Last-Event-ID, Content-Type",
};

const streamHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...corsHeaders,
};

const trimToUndefined = (value: string | null | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const parseBoolean = (value: string | undefined) =>
  Boolean(value && ["1", "true", "yes", "on"].includes(value.toLowerCase()));

const coerceToNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getReconnectDelay = (attempt: number) =>
  Math.min(
    RECONNECT_BASE_MS * 2 ** Math.max(attempt - 1, 0),
    RECONNECT_MAX_MS
  );

const formatSseMessage = ({
  event,
  data,
  id,
  retry,
}: {
  event?: string;
  data?: unknown;
  id?: string;
  retry?: number;
}) => {
  const lines: string[] = [];

  if (typeof retry === "number") {
    lines.push(`retry: ${retry}`);
  }

  if (id) {
    lines.push(`id: ${id}`);
  }

  if (event) {
    lines.push(`event: ${event}`);
  }

  if (data !== undefined) {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    serialized.split("\n").forEach((line) => {
      lines.push(`data: ${line}`);
    });
  }

  return `${lines.join("\n")}\n\n`;
};

const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Unknown stream error.";
};

const safeParseJson = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
};

const readSocketMessage = (event: MessageEvent<unknown>) => {
  if (typeof event.data === "string") {
    return event.data;
  }

  if (event.data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(event.data));
  }

  return null;
};

const splitListParam = (value: string | null | undefined) =>
  (value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeSymbolInput = (value: string) => value.trim().toUpperCase();

const parseSymbol = (rawValue: string): NormalizedSymbol | null => {
  const normalizedValue = normalizeSymbolInput(rawValue);
  if (!normalizedValue) {
    return null;
  }

  const delimitedParts = normalizedValue
    .split(/[^A-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (delimitedParts.length === 2) {
    const [base, quote] = delimitedParts;
    return {
      input: rawValue,
      base,
      quote,
      display: `${base}/${quote}`,
      binance: `${base}${quote}`,
      coinbase: `${base}-${quote}`,
    };
  }

  for (const quote of SUPPORTED_QUOTES) {
    if (!normalizedValue.endsWith(quote) || normalizedValue.length === quote.length) {
      continue;
    }

    const base = normalizedValue.slice(0, normalizedValue.length - quote.length);
    return {
      input: rawValue,
      base,
      quote,
      display: `${base}/${quote}`,
      binance: `${base}${quote}`,
      coinbase: `${base}-${quote}`,
    };
  }

  return null;
};

const parseRequestedSymbols = (request: Request, env: TradingStreamEnv) => {
  const url = new URL(request.url);
  const rawSymbols = [
    ...url.searchParams.getAll("symbol"),
    ...url.searchParams.getAll("symbols").flatMap(splitListParam),
  ];

  const defaultSymbols = rawSymbols.length
    ? rawSymbols
    : splitListParam(trimToUndefined(env.TRADING_DEFAULT_SYMBOL) || "").length
      ? splitListParam(trimToUndefined(env.TRADING_DEFAULT_SYMBOL))
      : DEFAULT_SYMBOLS;

  const seenDisplays = new Set<string>();
  const parsedSymbols: NormalizedSymbol[] = [];

  for (const symbol of defaultSymbols) {
    const parsedSymbol = parseSymbol(symbol);
    if (!parsedSymbol || seenDisplays.has(parsedSymbol.display)) {
      continue;
    }

    seenDisplays.add(parsedSymbol.display);
    parsedSymbols.push(parsedSymbol);

    if (parsedSymbols.length >= MAX_SYMBOLS) {
      break;
    }
  }

  return parsedSymbols;
};

const parseRequestedProviders = (request: Request) => {
  const url = new URL(request.url);
  const rawProviders = [
    ...url.searchParams.getAll("provider"),
    ...url.searchParams.getAll("providers").flatMap(splitListParam),
  ];

  if (!rawProviders.length) {
    return DEFAULT_PROVIDERS;
  }

  const seenProviders = new Set<TradingProviderId>();
  const providers: TradingProviderId[] = [];

  for (const provider of rawProviders) {
    const normalizedProvider = provider.trim().toLowerCase();
    if (
      (normalizedProvider === "binance" || normalizedProvider === "coinbase") &&
      !seenProviders.has(normalizedProvider)
    ) {
      seenProviders.add(normalizedProvider);
      providers.push(normalizedProvider);
    }
  }

  return providers.length ? providers : DEFAULT_PROVIDERS;
};

const formatDisplaySymbol = (value: string) => {
  if (value.includes("-")) {
    const [base, quote] = value.split("-");
    return `${base}/${quote}`;
  }

  for (const quote of SUPPORTED_QUOTES) {
    if (!value.endsWith(quote) || value.length === quote.length) {
      continue;
    }

    return `${value.slice(0, value.length - quote.length)}/${quote}`;
  }

  return value;
};

const computeSignalMetrics = (changePct: number) => {
  const absoluteChange = Math.abs(changePct);

  return {
    direction: changePct >= 0 ? "UP" : "DOWN",
    strength: clamp(Math.round(absoluteChange * 10), 5, 100),
    confidence: clamp(Math.round(55 + absoluteChange * 6), 55, 99),
  } as const;
};

const toIsoTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return new Date().toISOString();
};

const mapTradeStatus = (value: unknown): TradingTradeEvent["status"] => {
  const normalizedValue = typeof value === "string" ? value.toUpperCase() : "";

  if (["NEW", "OPEN", "PARTIALLY_FILLED"].includes(normalizedValue)) {
    return "OPEN";
  }

  if (["PENDING", "RECEIVED"].includes(normalizedValue)) {
    return "PENDING";
  }

  return "CLOSED";
};

const isStableValueAsset = (asset: string) => STABLE_VALUE_ASSETS.has(asset.toUpperCase());

const toBase64Url = (value: Uint8Array | string) => {
  const bytes =
    typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Pem = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const concatBytes = (...chunks: Uint8Array[]) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

const encodeDerLength = (length: number) => {
  if (length < 0x80) {
    return Uint8Array.of(length);
  }

  const bytes: number[] = [];
  let remaining = length;

  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  return Uint8Array.of(0x80 | bytes.length, ...bytes);
};

const encodeDerInteger = (value: number) => {
  const encodedValue = Uint8Array.of(value);
  return concatBytes(Uint8Array.of(0x02), encodeDerLength(encodedValue.length), encodedValue);
};

const encodeDerOctetString = (value: Uint8Array) =>
  concatBytes(Uint8Array.of(0x04), encodeDerLength(value.length), value);

const encodeDerSequence = (...values: Uint8Array[]) => {
  const body = concatBytes(...values);
  return concatBytes(Uint8Array.of(0x30), encodeDerLength(body.length), body);
};

const wrapSec1KeyAsPkcs8 = (sec1Key: Uint8Array) => {
  const ecPublicKeyOid = Uint8Array.of(
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01
  );
  const prime256v1Oid = Uint8Array.of(
    0x06,
    0x08,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x03,
    0x01,
    0x07
  );

  return encodeDerSequence(
    encodeDerInteger(0),
    encodeDerSequence(ecPublicKeyOid, prime256v1Oid),
    encodeDerOctetString(sec1Key)
  );
};

const importCoinbaseSigningKey = async (rawPem: string) => {
  const pem = rawPem.trim();
  const base64Body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const derBytes = fromBase64Pem(base64Body);
  const pkcs8Bytes = pem.includes("BEGIN EC PRIVATE KEY")
    ? wrapSec1KeyAsPkcs8(derBytes)
    : derBytes;

  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"]
  );
};

const buildCoinbaseJwt = async (apiKey: string, signingKey: CryptoKey) => {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: apiKey,
    nonce: Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
    typ: "JWT",
  };
  const payload = {
    iss: "cdp",
    sub: apiKey,
    nbf: issuedAtSeconds,
    exp: issuedAtSeconds + 120,
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    signingKey,
    encoder.encode(unsignedToken)
  );

  return `${unsignedToken}.${toBase64Url(new Uint8Array(signature))}`;
};

const createBinanceListenKey = async (apiKey: string, useSandbox: boolean) => {
  const baseUrl = useSandbox ? "https://testnet.binance.vision" : "https://api.binance.com";
  const response = await fetch(`${baseUrl}/api/v3/userDataStream`, {
    method: "POST",
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Binance listen key request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { listenKey?: string };
  const listenKey = trimToUndefined(payload.listenKey);

  if (!listenKey) {
    throw new Error("Binance listen key response did not include a listenKey.");
  }

  return {
    listenKey,
    baseUrl,
  };
};

const refreshBinanceListenKey = async (
  apiKey: string,
  baseUrl: string,
  listenKey: string
) => {
  const response = await fetch(
    `${baseUrl}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`,
    {
      method: "PUT",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Binance listen key keepalive failed with status ${response.status}.`);
  }
};

const deleteBinanceListenKey = async (
  apiKey: string,
  baseUrl: string,
  listenKey: string
) => {
  await fetch(
    `${baseUrl}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`,
    {
      method: "DELETE",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    }
  ).catch(() => undefined);
};

const createBinanceConnector = (context: StreamContext): ManagedSocket => {
  const { env, symbols, safeEnqueue, emitProviderStatus, emitStreamError, registerCleanup, isClosed } =
    context;
  const exchangeName = "Binance";
  const marketStreams = symbols.flatMap((symbol) => [
    `${symbol.binance.toLowerCase()}@trade`,
    `${symbol.binance.toLowerCase()}@ticker`,
  ]);
  const useSandbox = parseBoolean(trimToUndefined(env.BINANCE_SANDBOX));
  const marketBaseUrl = useSandbox
    ? "wss://testnet.binance.vision"
    : "wss://stream.binance.com:9443";
  const accountApiKey = trimToUndefined(env.BINANCE_API_KEY);
  const accountAssetBalances = new Map<string, { free: number; locked: number }>();

  let marketSocket: WebSocket | null = null;
  let accountSocket: WebSocket | null = null;
  let marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let accountReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let accountKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let currentListenKey: string | null = null;
  let currentListenKeyBaseUrl: string | null = null;
  let marketReconnectAttempt = 0;
  let accountReconnectAttempt = 0;
  let manuallyClosed = false;

  const clearMarketReconnect = () => {
    if (marketReconnectTimer) {
      clearTimeout(marketReconnectTimer);
      marketReconnectTimer = null;
    }
  };

  const clearAccountReconnect = () => {
    if (accountReconnectTimer) {
      clearTimeout(accountReconnectTimer);
      accountReconnectTimer = null;
    }
  };

  const clearAccountKeepAlive = () => {
    if (accountKeepAliveTimer) {
      clearInterval(accountKeepAliveTimer);
      accountKeepAliveTimer = null;
    }
  };

  const emitTrade = (trade: TradingTradeEvent) => {
    safeEnqueue({
      event: "trade",
      id: trade.id,
      data: trade,
    });
  };

  const emitBalance = (balance: TradingBalanceEvent) => {
    safeEnqueue({
      event: "balance",
      id: balance.id,
      data: balance,
    });
  };

  const emitSignal = (signal: TradingSignalEvent) => {
    safeEnqueue({
      event: "signal",
      data: signal,
    });
  };

  const scheduleMarketReconnect = (message: string) => {
    if (manuallyClosed || isClosed() || marketReconnectTimer) {
      return;
    }

    marketReconnectAttempt += 1;
    emitProviderStatus(
      "binance",
      exchangeName,
      "market",
      "reconnecting",
      message,
      marketReconnectAttempt
    );
    marketReconnectTimer = setTimeout(() => {
      marketReconnectTimer = null;
      connectMarketSocket();
    }, getReconnectDelay(marketReconnectAttempt));
  };

  const scheduleAccountReconnect = (message: string) => {
    if (manuallyClosed || isClosed() || accountReconnectTimer || !accountApiKey) {
      return;
    }

    accountReconnectAttempt += 1;
    emitProviderStatus(
      "binance",
      exchangeName,
      "account",
      "reconnecting",
      message,
      accountReconnectAttempt
    );
    accountReconnectTimer = setTimeout(() => {
      accountReconnectTimer = null;
      connectAccountSocket();
    }, getReconnectDelay(accountReconnectAttempt));
  };

  const handleMarketMessage = (payload: Record<string, unknown>) => {
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : payload;
    const eventType = typeof data.e === "string" ? data.e : "";

    if (eventType === "trade") {
      const price = coerceToNumber(data.p);
      const amount = coerceToNumber(data.q);
      if (price === null || amount === null) {
        return;
      }

      emitTrade({
        id: `binance:market:${String(data.s || "UNKNOWN")}:${String(data.t || crypto.randomUUID())}`,
        pair: formatDisplaySymbol(String(data.s || "")),
        type: data.m === true ? "SELL" : "BUY",
        amount,
        price,
        profit: 0,
        timestamp: toIsoTimestamp(data.T ?? data.E),
        status: "CLOSED",
        exchange: exchangeName,
        provider: "binance",
        marketPrice: price,
      });
      return;
    }

    if (eventType === "24hrTicker") {
      const price = coerceToNumber(data.c);
      const changePct = coerceToNumber(data.P);
      const bid = coerceToNumber(data.b);
      const ask = coerceToNumber(data.a);

      if (price === null || changePct === null) {
        return;
      }

      const metrics = computeSignalMetrics(changePct);
      emitSignal({
        pair: formatDisplaySymbol(String(data.s || "")),
        direction: metrics.direction,
        strength: metrics.strength,
        confidence: metrics.confidence,
        timeframe: "24H",
        exchange: exchangeName,
        provider: "binance",
        price,
        changePct,
        bid,
        ask,
        timestamp: toIsoTimestamp(data.E),
      });
    }
  };

  const handleAccountMessage = (payload: Record<string, unknown>) => {
    const data =
      payload.event && typeof payload.event === "object"
        ? (payload.event as Record<string, unknown>)
        : payload;
    const eventType = typeof data.e === "string" ? data.e : "";

    if (eventType === "outboundAccountPosition" && Array.isArray(data.B)) {
      data.B.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }

        const asset = String((entry as Record<string, unknown>).a || "");
        const free = coerceToNumber((entry as Record<string, unknown>).f) ?? 0;
        const locked = coerceToNumber((entry as Record<string, unknown>).l) ?? 0;

        if (!asset) {
          return;
        }

        accountAssetBalances.set(asset, { free, locked });
        emitBalance({
          id: `binance:balance:${asset}:${String(data.u || data.E || crypto.randomUUID())}`,
          exchange: exchangeName,
          provider: "binance",
          asset,
          currency: asset,
          totalBalance: free + locked,
          availableBalance: free,
          lockedBalance: locked,
          change: null,
          timestamp: toIsoTimestamp(data.u ?? data.E),
        });
      });
      return;
    }

    if (eventType === "balanceUpdate") {
      const asset = String(data.a || "");
      const delta = coerceToNumber(data.d) ?? 0;
      const existingBalance = accountAssetBalances.get(asset) || { free: 0, locked: 0 };
      const nextBalance = {
        free: existingBalance.free + delta,
        locked: existingBalance.locked,
      };

      if (asset) {
        accountAssetBalances.set(asset, nextBalance);
        emitBalance({
          id: `binance:balance:${asset}:${String(data.T || data.E || crypto.randomUUID())}`,
          exchange: exchangeName,
          provider: "binance",
          asset,
          currency: asset,
          totalBalance: nextBalance.free + nextBalance.locked,
          availableBalance: nextBalance.free,
          lockedBalance: nextBalance.locked,
          change: delta,
          timestamp: toIsoTimestamp(data.T ?? data.E),
        });
      }
      return;
    }

    if (eventType === "executionReport") {
      const orderQuantity = coerceToNumber(data.q) ?? 0;
      const cumulativeQuantity = coerceToNumber(data.z) ?? 0;
      const lastPrice = coerceToNumber(data.L);
      const limitPrice = coerceToNumber(data.p) ?? 0;
      const quoteTransacted = coerceToNumber(data.Z);
      const marketPrice =
        quoteTransacted !== null && cumulativeQuantity > 0
          ? quoteTransacted / cumulativeQuantity
          : lastPrice ?? limitPrice;

      emitTrade({
        id: `binance:execution:${String(data.i || "order")}:${String(data.I || data.t || crypto.randomUUID())}`,
        pair: formatDisplaySymbol(String(data.s || "")),
        type: String(data.S || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
        amount: cumulativeQuantity || orderQuantity,
        price: lastPrice ?? limitPrice,
        profit: 0,
        timestamp: toIsoTimestamp(data.T ?? data.E),
        status: mapTradeStatus(data.X),
        exchange: exchangeName,
        provider: "binance",
        marketPrice: marketPrice ?? undefined,
        fee: coerceToNumber(data.n) ?? undefined,
      });
      return;
    }

    if (eventType === "eventStreamTerminated") {
      emitStreamError({
        provider: "binance",
        exchange: exchangeName,
        scope: "account",
        message: "Binance account stream expired. Reconnecting with a fresh listen key.",
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
      accountSocket?.close();
    }
  };

  function connectMarketSocket() {
    if (manuallyClosed || isClosed()) {
      return;
    }

    clearMarketReconnect();
    marketSocket?.close();
    emitProviderStatus(
      "binance",
      exchangeName,
      "market",
      marketReconnectAttempt > 0 ? "reconnecting" : "connecting",
      "Connecting Binance market data stream.",
      marketReconnectAttempt
    );

    try {
      const socket = new WebSocket(
        `${marketBaseUrl}/stream?streams=${marketStreams.join("/")}`
      );
      marketSocket = socket;

      socket.addEventListener("open", () => {
        marketReconnectAttempt = 0;
        emitProviderStatus(
          "binance",
          exchangeName,
          "market",
          "connected",
          "Binance market data stream connected.",
          marketReconnectAttempt
        );
      });

      socket.addEventListener("message", (event) => {
        const rawMessage = readSocketMessage(event);
        const payload = safeParseJson(rawMessage);

        if (!payload) {
          return;
        }

        handleMarketMessage(payload);
      });

      socket.addEventListener("error", () => {
        emitStreamError({
          provider: "binance",
          exchange: exchangeName,
          scope: "market",
          message: "Binance market socket reported an error.",
          recoverable: true,
          timestamp: new Date().toISOString(),
        });
      });

      socket.addEventListener("close", () => {
        if (marketSocket === socket) {
          marketSocket = null;
        }

        if (!manuallyClosed && !isClosed()) {
          scheduleMarketReconnect("Binance market socket closed. Retrying.");
        }
      });
    } catch (error) {
      emitStreamError({
        provider: "binance",
        exchange: exchangeName,
        scope: "market",
        message: normalizeErrorMessage(error),
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
      scheduleMarketReconnect("Unable to open the Binance market socket. Retrying.");
    }
  }

  async function connectAccountSocket() {
    if (manuallyClosed || isClosed()) {
      return;
    }

    if (!accountApiKey) {
      emitProviderStatus(
        "binance",
        exchangeName,
        "account",
        "disconnected",
        "Binance account updates are disabled because BINANCE_API_KEY is not configured.",
        0
      );
      return;
    }

    clearAccountReconnect();
    clearAccountKeepAlive();
    accountSocket?.close();
    emitProviderStatus(
      "binance",
      exchangeName,
      "account",
      accountReconnectAttempt > 0 ? "reconnecting" : "connecting",
      "Connecting Binance account stream.",
      accountReconnectAttempt
    );

    try {
      const { listenKey, baseUrl } = await createBinanceListenKey(accountApiKey, useSandbox);
      if (manuallyClosed || isClosed()) {
        await deleteBinanceListenKey(accountApiKey, baseUrl, listenKey);
        return;
      }

      currentListenKey = listenKey;
      currentListenKeyBaseUrl = baseUrl;
      const socket = new WebSocket(`${marketBaseUrl}/ws/${listenKey}`);
      accountSocket = socket;

      socket.addEventListener("open", () => {
        accountReconnectAttempt = 0;
        emitProviderStatus(
          "binance",
          exchangeName,
          "account",
          "connected",
          "Binance account stream connected.",
          accountReconnectAttempt
        );

        clearAccountKeepAlive();
        accountKeepAliveTimer = setInterval(() => {
          if (!currentListenKey || !currentListenKeyBaseUrl || !accountApiKey) {
            return;
          }

          refreshBinanceListenKey(
            accountApiKey,
            currentListenKeyBaseUrl,
            currentListenKey
          ).catch((error) => {
            emitStreamError({
              provider: "binance",
              exchange: exchangeName,
              scope: "account",
              message: `Binance listen key keepalive failed: ${normalizeErrorMessage(error)}`,
              recoverable: true,
              timestamp: new Date().toISOString(),
            });
          });
        }, BINANCE_LISTEN_KEY_REFRESH_MS);
      });

      socket.addEventListener("message", (event) => {
        const rawMessage = readSocketMessage(event);
        const payload = safeParseJson(rawMessage);

        if (!payload) {
          return;
        }

        handleAccountMessage(payload);
      });

      socket.addEventListener("error", () => {
        emitStreamError({
          provider: "binance",
          exchange: exchangeName,
          scope: "account",
          message: "Binance account socket reported an error.",
          recoverable: true,
          timestamp: new Date().toISOString(),
        });
      });

      socket.addEventListener("close", () => {
        if (accountSocket === socket) {
          accountSocket = null;
        }

        clearAccountKeepAlive();

        const listenKeyToDelete = currentListenKey;
        const listenKeyBaseUrlToDelete = currentListenKeyBaseUrl;
        currentListenKey = null;
        currentListenKeyBaseUrl = null;

        if (listenKeyToDelete && listenKeyBaseUrlToDelete && accountApiKey) {
          void deleteBinanceListenKey(
            accountApiKey,
            listenKeyBaseUrlToDelete,
            listenKeyToDelete
          );
        }

        if (!manuallyClosed && !isClosed()) {
          scheduleAccountReconnect("Binance account socket closed. Retrying.");
        }
      });
    } catch (error) {
      emitStreamError({
        provider: "binance",
        exchange: exchangeName,
        scope: "account",
        message: normalizeErrorMessage(error),
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
      scheduleAccountReconnect("Unable to initialize the Binance account stream. Retrying.");
    }
  }

  connectMarketSocket();
  void connectAccountSocket();

  registerCleanup(async () => {
    manuallyClosed = true;
    clearMarketReconnect();
    clearAccountReconnect();
    clearAccountKeepAlive();
    marketSocket?.close();
    accountSocket?.close();

    if (accountApiKey && currentListenKey && currentListenKeyBaseUrl) {
      await deleteBinanceListenKey(accountApiKey, currentListenKeyBaseUrl, currentListenKey);
    }
  });

  return {
    close: () => {
      manuallyClosed = true;
      clearMarketReconnect();
      clearAccountReconnect();
      clearAccountKeepAlive();
      marketSocket?.close();
      accountSocket?.close();
    },
  };
};

const createCoinbaseConnector = (context: StreamContext): ManagedSocket => {
  const { env, symbols, safeEnqueue, emitProviderStatus, emitStreamError, registerCleanup, isClosed } =
    context;
  const exchangeName = "Coinbase";
  const productIds = symbols.map((symbol) => symbol.coinbase);
  const apiKey = trimToUndefined(env.COINBASE_API_KEY);
  const apiSecret = trimToUndefined(env.COINBASE_SECRET);

  let marketSocket: WebSocket | null = null;
  let accountSocket: WebSocket | null = null;
  let marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let accountReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let marketReconnectAttempt = 0;
  let accountReconnectAttempt = 0;
  let manuallyClosed = false;
  let signingKeyPromise: Promise<CryptoKey> | null = null;

  const clearMarketReconnect = () => {
    if (marketReconnectTimer) {
      clearTimeout(marketReconnectTimer);
      marketReconnectTimer = null;
    }
  };

  const clearAccountReconnect = () => {
    if (accountReconnectTimer) {
      clearTimeout(accountReconnectTimer);
      accountReconnectTimer = null;
    }
  };

  const getSigningKey = () => {
    if (!apiSecret) {
      throw new Error("COINBASE_SECRET is required for Coinbase private channel subscriptions.");
    }

    if (!signingKeyPromise) {
      signingKeyPromise = importCoinbaseSigningKey(apiSecret);
    }

    return signingKeyPromise;
  };

  const emitTrade = (trade: TradingTradeEvent) => {
    safeEnqueue({
      event: "trade",
      id: trade.id,
      data: trade,
    });
  };

  const emitBalance = (balance: TradingBalanceEvent) => {
    safeEnqueue({
      event: "balance",
      id: balance.id,
      data: balance,
    });
  };

  const emitSignal = (signal: TradingSignalEvent) => {
    safeEnqueue({
      event: "signal",
      data: signal,
    });
  };

  const scheduleMarketReconnect = (message: string) => {
    if (manuallyClosed || isClosed() || marketReconnectTimer) {
      return;
    }

    marketReconnectAttempt += 1;
    emitProviderStatus(
      "coinbase",
      exchangeName,
      "market",
      "reconnecting",
      message,
      marketReconnectAttempt
    );
    marketReconnectTimer = setTimeout(() => {
      marketReconnectTimer = null;
      connectMarketSocket();
    }, getReconnectDelay(marketReconnectAttempt));
  };

  const scheduleAccountReconnect = (message: string) => {
    if (manuallyClosed || isClosed() || accountReconnectTimer || !apiKey || !apiSecret) {
      return;
    }

    accountReconnectAttempt += 1;
    emitProviderStatus(
      "coinbase",
      exchangeName,
      "account",
      "reconnecting",
      message,
      accountReconnectAttempt
    );
    accountReconnectTimer = setTimeout(() => {
      accountReconnectTimer = null;
      void connectAccountSocket();
    }, getReconnectDelay(accountReconnectAttempt));
  };

  const sendCoinbaseSubscribe = async ({
    socket,
    channel,
    includeJwt,
    channelProductIds,
  }: {
    socket: WebSocket;
    channel: string;
    includeJwt: boolean;
    channelProductIds?: string[];
  }) => {
    const payload: Record<string, unknown> = {
      type: "subscribe",
      channel,
    };

    if (channelProductIds?.length) {
      payload.product_ids = channelProductIds;
    }

    if (includeJwt) {
      if (!apiKey) {
        throw new Error("COINBASE_API_KEY is required for Coinbase authenticated subscriptions.");
      }

      payload.jwt = await buildCoinbaseJwt(apiKey, await getSigningKey());
    }

    socket.send(JSON.stringify(payload));
  };

  const handleTickerMessage = (payload: Record<string, unknown>) => {
    if (!Array.isArray(payload.events)) {
      return;
    }

    payload.events.forEach((eventEntry) => {
      if (!eventEntry || typeof eventEntry !== "object") {
        return;
      }

      const eventRecord = eventEntry as Record<string, unknown>;
      if (!Array.isArray(eventRecord.tickers)) {
        return;
      }

      eventRecord.tickers.forEach((tickerEntry) => {
        if (!tickerEntry || typeof tickerEntry !== "object") {
          return;
        }

        const ticker = tickerEntry as Record<string, unknown>;
        const price = coerceToNumber(ticker.price);
        const changePct = coerceToNumber(ticker.price_percent_chg_24_h);
        const bid = coerceToNumber(ticker.best_bid);
        const ask = coerceToNumber(ticker.best_ask);

        if (price === null || changePct === null) {
          return;
        }

        const metrics = computeSignalMetrics(changePct);
        emitSignal({
          pair: formatDisplaySymbol(String(ticker.product_id || "")),
          direction: metrics.direction,
          strength: metrics.strength,
          confidence: metrics.confidence,
          timeframe: "24H",
          exchange: exchangeName,
          provider: "coinbase",
          price,
          changePct,
          bid,
          ask,
          timestamp: toIsoTimestamp(payload.timestamp),
        });
      });
    });
  };

  const handleMarketTradesMessage = (payload: Record<string, unknown>) => {
    if (!Array.isArray(payload.events)) {
      return;
    }

    payload.events.forEach((eventEntry) => {
      if (!eventEntry || typeof eventEntry !== "object") {
        return;
      }

      const eventRecord = eventEntry as Record<string, unknown>;
      if (!Array.isArray(eventRecord.trades)) {
        return;
      }

      eventRecord.trades.forEach((tradeEntry) => {
        if (!tradeEntry || typeof tradeEntry !== "object") {
          return;
        }

        const trade = tradeEntry as Record<string, unknown>;
        const price = coerceToNumber(trade.price);
        const amount = coerceToNumber(trade.size);

        if (price === null || amount === null) {
          return;
        }

        emitTrade({
          id: `coinbase:market:${String(trade.product_id || "UNKNOWN")}:${String(trade.trade_id || crypto.randomUUID())}`,
          pair: formatDisplaySymbol(String(trade.product_id || "")),
          type: String(trade.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
          amount,
          price,
          profit: 0,
          timestamp: toIsoTimestamp(trade.time || payload.timestamp),
          status: "CLOSED",
          exchange: exchangeName,
          provider: "coinbase",
          marketPrice: price,
        });
      });
    });
  };

  const handleUserMessage = (payload: Record<string, unknown>) => {
    if (!Array.isArray(payload.events)) {
      return;
    }

    payload.events.forEach((eventEntry) => {
      if (!eventEntry || typeof eventEntry !== "object") {
        return;
      }

      const eventRecord = eventEntry as Record<string, unknown>;
      if (!Array.isArray(eventRecord.orders)) {
        return;
      }

      eventRecord.orders.forEach((orderEntry) => {
        if (!orderEntry || typeof orderEntry !== "object") {
          return;
        }

        const order = orderEntry as Record<string, unknown>;
        const averagePrice = coerceToNumber(order.avg_price) ?? coerceToNumber(order.limit_price) ?? 0;
        const amount = coerceToNumber(order.cumulative_quantity) ?? 0;

        emitTrade({
          id: `coinbase:user:${String(order.order_id || crypto.randomUUID())}:${String(order.creation_time || payload.timestamp)}`,
          pair: formatDisplaySymbol(String(order.product_id || "")),
          type: String(order.order_side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
          amount,
          price: averagePrice,
          profit: 0,
          timestamp: toIsoTimestamp(order.creation_time || payload.timestamp),
          status: mapTradeStatus(order.status),
          exchange: exchangeName,
          provider: "coinbase",
          marketPrice: averagePrice || undefined,
          fee: coerceToNumber(order.total_fees) ?? undefined,
        });
      });
    });
  };

  const handleBalanceSummaryMessage = (payload: Record<string, unknown>) => {
    if (!Array.isArray(payload.events)) {
      return;
    }

    payload.events.forEach((eventEntry) => {
      if (!eventEntry || typeof eventEntry !== "object") {
        return;
      }

      const summary = (eventEntry as Record<string, unknown>).fcm_balance_summary;
      if (!summary || typeof summary !== "object") {
        return;
      }

      const summaryRecord = summary as Record<string, unknown>;
      const totalUsdBalance = coerceToNumber(summaryRecord.total_usd_balance);
      const availableMargin = coerceToNumber(summaryRecord.available_margin);
      const openOrderHold = coerceToNumber(summaryRecord.total_open_orders_hold_amount) ?? 0;

      if (totalUsdBalance === null || availableMargin === null) {
        return;
      }

      emitBalance({
        id: `coinbase:balance:${String(payload.timestamp || crypto.randomUUID())}`,
        exchange: exchangeName,
        provider: "coinbase",
        asset: "USD",
        currency: "USD",
        totalBalance: totalUsdBalance,
        availableBalance: availableMargin,
        lockedBalance: Math.max(openOrderHold, 0),
        change: null,
        timestamp: toIsoTimestamp(payload.timestamp),
      });
    });
  };

  function connectMarketSocket() {
    if (manuallyClosed || isClosed()) {
      return;
    }

    clearMarketReconnect();
    marketSocket?.close();
    emitProviderStatus(
      "coinbase",
      exchangeName,
      "market",
      marketReconnectAttempt > 0 ? "reconnecting" : "connecting",
      "Connecting Coinbase market data stream.",
      marketReconnectAttempt
    );

    try {
      const socket = new WebSocket("wss://advanced-trade-ws.coinbase.com");
      marketSocket = socket;

      socket.addEventListener("open", () => {
        marketReconnectAttempt = 0;
        emitProviderStatus(
          "coinbase",
          exchangeName,
          "market",
          "connected",
          "Coinbase market data stream connected.",
          marketReconnectAttempt
        );

        void sendCoinbaseSubscribe({
          socket,
          channel: "heartbeats",
          includeJwt: false,
        }).catch((error) => {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "market",
            message: normalizeErrorMessage(error),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
        });

        void sendCoinbaseSubscribe({
          socket,
          channel: "ticker",
          includeJwt: false,
          channelProductIds: productIds,
        }).catch((error) => {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "market",
            message: normalizeErrorMessage(error),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
        });

        void sendCoinbaseSubscribe({
          socket,
          channel: "market_trades",
          includeJwt: false,
          channelProductIds: productIds,
        }).catch((error) => {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "market",
            message: normalizeErrorMessage(error),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
        });
      });

      socket.addEventListener("message", (event) => {
        const rawMessage = readSocketMessage(event);
        const payload = safeParseJson(rawMessage);

        if (!payload) {
          return;
        }

        if (payload.type === "error") {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "market",
            message: String(payload.message || "Coinbase market channel returned an error."),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (payload.channel === "ticker") {
          handleTickerMessage(payload);
        }

        if (payload.channel === "market_trades") {
          handleMarketTradesMessage(payload);
        }
      });

      socket.addEventListener("error", () => {
        emitStreamError({
          provider: "coinbase",
          exchange: exchangeName,
          scope: "market",
          message: "Coinbase market socket reported an error.",
          recoverable: true,
          timestamp: new Date().toISOString(),
        });
      });

      socket.addEventListener("close", () => {
        if (marketSocket === socket) {
          marketSocket = null;
        }

        if (!manuallyClosed && !isClosed()) {
          scheduleMarketReconnect("Coinbase market socket closed. Retrying.");
        }
      });
    } catch (error) {
      emitStreamError({
        provider: "coinbase",
        exchange: exchangeName,
        scope: "market",
        message: normalizeErrorMessage(error),
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
      scheduleMarketReconnect("Unable to open the Coinbase market socket. Retrying.");
    }
  }

  async function connectAccountSocket() {
    if (manuallyClosed || isClosed()) {
      return;
    }

    if (!apiKey || !apiSecret) {
      emitProviderStatus(
        "coinbase",
        exchangeName,
        "account",
        "disconnected",
        "Coinbase private channels are disabled because COINBASE_API_KEY and COINBASE_SECRET are not configured.",
        0
      );
      return;
    }

    clearAccountReconnect();
    accountSocket?.close();
    emitProviderStatus(
      "coinbase",
      exchangeName,
      "account",
      accountReconnectAttempt > 0 ? "reconnecting" : "connecting",
      "Connecting Coinbase account stream.",
      accountReconnectAttempt
    );

    try {
      const socket = new WebSocket("wss://advanced-trade-ws-user.coinbase.com");
      accountSocket = socket;

      socket.addEventListener("open", () => {
        accountReconnectAttempt = 0;
        emitProviderStatus(
          "coinbase",
          exchangeName,
          "account",
          "connected",
          "Coinbase account stream connected.",
          accountReconnectAttempt
        );

        void sendCoinbaseSubscribe({
          socket,
          channel: "heartbeats",
          includeJwt: true,
        }).catch((error) => {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "account",
            message: normalizeErrorMessage(error),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
        });

        void sendCoinbaseSubscribe({
          socket,
          channel: "user",
          includeJwt: true,
          channelProductIds: productIds,
        }).catch((error) => {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "account",
            message: normalizeErrorMessage(error),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
        });

        void sendCoinbaseSubscribe({
          socket,
          channel: "futures_balance_summary",
          includeJwt: true,
        }).catch((error) => {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "account",
            message: normalizeErrorMessage(error),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
        });
      });

      socket.addEventListener("message", (event) => {
        const rawMessage = readSocketMessage(event);
        const payload = safeParseJson(rawMessage);

        if (!payload) {
          return;
        }

        if (payload.type === "error") {
          emitStreamError({
            provider: "coinbase",
            exchange: exchangeName,
            scope: "account",
            message: String(payload.message || "Coinbase account channel returned an error."),
            recoverable: true,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (payload.channel === "user") {
          handleUserMessage(payload);
        }

        if (payload.channel === "futures_balance_summary") {
          handleBalanceSummaryMessage(payload);
        }
      });

      socket.addEventListener("error", () => {
        emitStreamError({
          provider: "coinbase",
          exchange: exchangeName,
          scope: "account",
          message: "Coinbase account socket reported an error.",
          recoverable: true,
          timestamp: new Date().toISOString(),
        });
      });

      socket.addEventListener("close", () => {
        if (accountSocket === socket) {
          accountSocket = null;
        }

        if (!manuallyClosed && !isClosed()) {
          scheduleAccountReconnect("Coinbase account socket closed. Retrying.");
        }
      });
    } catch (error) {
      emitStreamError({
        provider: "coinbase",
        exchange: exchangeName,
        scope: "account",
        message: normalizeErrorMessage(error),
        recoverable: true,
        timestamp: new Date().toISOString(),
      });
      scheduleAccountReconnect("Unable to open the Coinbase account socket. Retrying.");
    }
  }

  connectMarketSocket();
  void connectAccountSocket();

  registerCleanup(() => {
    manuallyClosed = true;
    clearMarketReconnect();
    clearAccountReconnect();
    marketSocket?.close();
    accountSocket?.close();
  });

  return {
    close: () => {
      manuallyClosed = true;
      clearMarketReconnect();
      clearAccountReconnect();
      marketSocket?.close();
      accountSocket?.close();
    },
  };
};

const buildInitialPlatformSnapshot = (providers: TradingProviderId[], symbols: NormalizedSymbol[]) =>
  providers.map((provider) => ({
    provider,
    exchange: provider === "binance" ? "Binance" : "Coinbase",
    subscribedSymbols: symbols.map((symbol) => symbol.display),
  }));

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
  env: TradingStreamEnv;
}) => {
  const symbols = parseRequestedSymbols(request, env);
  const providers = parseRequestedProviders(request);
  let closeStream: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const cleanups = new Set<() => void | Promise<void>>();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const safeEnqueue = ({
        event,
        data,
        id,
        retry,
      }: {
        event?: string;
        data?: unknown;
        id?: string;
        retry?: number;
      }) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(
            encoder.encode(
              formatSseMessage({
                event,
                data,
                id,
                retry,
              })
            )
          );
        } catch (_error) {
          void closeStream?.();
        }
      };

      const emitProviderStatus: StreamContext["emitProviderStatus"] = (
        provider,
        exchange,
        scope,
        status,
        message,
        reconnectAttempt
      ) => {
        safeEnqueue({
          event: "provider-status",
          data: {
            provider,
            exchange,
            scope,
            status,
            message,
            reconnectAttempt,
            timestamp: new Date().toISOString(),
            subscribedSymbols: symbols.map((symbol) => symbol.display),
          } satisfies ProviderStatusEvent,
        });
      };

      const emitStreamError = (payload: StreamErrorEvent) => {
        safeEnqueue({
          event: "stream-error",
          data: payload,
        });
      };

      closeStream = async () => {
        if (closed) {
          return;
        }

        closed = true;

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        for (const cleanup of cleanups) {
          try {
            await cleanup();
          } catch (_error) {
            // Cleanup errors should not keep the SSE response open.
          }
        }

        try {
          controller.close();
        } catch (_error) {
          // The controller may already be closed by the runtime if the client disconnected.
        }
      };

      request.signal.addEventListener(
        "abort",
        () => {
          void closeStream?.();
        },
        { once: true }
      );

      safeEnqueue({
        event: "connected",
        retry: HEARTBEAT_RETRY_MS,
        data: {
          connectionId: crypto.randomUUID(),
          providers,
          symbols: symbols.map((symbol) => symbol.display),
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          reconnectDelayMs: HEARTBEAT_RETRY_MS,
          platforms: buildInitialPlatformSnapshot(providers, symbols),
        },
      });

      heartbeatTimer = setInterval(() => {
        safeEnqueue({
          event: "heartbeat",
          data: {
            timestamp: new Date().toISOString(),
          },
        });
      }, HEARTBEAT_INTERVAL_MS);

      if (!symbols.length) {
        emitStreamError({
          scope: "stream",
          message:
            "No valid symbols were provided. Use ?symbols=BTC/USDT,ETH/USD or ?symbol=BTC/USDT.",
          recoverable: false,
          timestamp: new Date().toISOString(),
        });
        await closeStream();
        return;
      }

      const context: StreamContext = {
        env,
        request,
        symbols,
        providers,
        safeEnqueue,
        emitProviderStatus,
        emitStreamError,
        registerCleanup: (cleanup) => {
          cleanups.add(cleanup);
        },
        isClosed: () => closed,
      };

      if (providers.includes("binance")) {
        createBinanceConnector(context);
      }

      if (providers.includes("coinbase")) {
        createCoinbaseConnector(context);
      }
    },
    cancel() {
      void closeStream?.();
    },
  });

  return new Response(stream, {
    headers: streamHeaders,
  });
};
