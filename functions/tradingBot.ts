// Sample TradingBot API used for the initial dashboard paint.
// The live `/trading/stream` SSE endpoint overlays real-time exchange updates on top of this
// payload so the page can render immediately before the first socket messages arrive.

type TradeType = "BUY" | "SELL";
type TradeStatus = "OPEN" | "CLOSED" | "PENDING";
type TradingProviderId = "binance" | "coinbase";

type Trade = {
  id: string;
  pair: string;
  type: TradeType;
  amount: number;
  price: number;
  profit: number;
  timestamp: string;
  status: TradeStatus;
  exchange: string;
  provider: TradingProviderId;
  marketPrice?: number;
  fee?: number;
};

type Signal = {
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

type BalanceUpdate = {
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

type Platform = {
  name: string;
  provider: TradingProviderId;
  status: "connected" | "disconnected" | "connecting" | "reconnecting" | "error";
  balance: number;
  currency: string;
  message: string;
  updatedAt: string;
  marketStatus: "connected" | "disconnected" | "connecting" | "reconnecting" | "error";
  accountStatus: "connected" | "disconnected" | "connecting" | "reconnecting" | "error";
  reconnectAttempts: number;
  subscribedSymbols: string[];
};

const DEFAULT_SYMBOLS = ["BTC/USDT", "ETH/USD"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

const splitSymbols = (rawValue: string | null) =>
  (rawValue || "")
    .split(/[,\s]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

const formatDisplayPair = (value: string) => {
  if (value.includes("/")) {
    return value;
  }

  if (value.includes("-")) {
    return value.replace("-", "/");
  }

  if (value.endsWith("USDT")) {
    return `${value.slice(0, -4)}/USDT`;
  }

  if (value.endsWith("USD")) {
    return `${value.slice(0, -3)}/USD`;
  }

  return value;
};

const resolveRequestedSymbols = (request: Request) => {
  const url = new URL(request.url);
  const requestedSymbols = [
    ...url.searchParams.getAll("symbol"),
    ...url.searchParams.getAll("symbols").flatMap(splitSymbols),
  ].map(formatDisplayPair);

  return requestedSymbols.length ? requestedSymbols.slice(0, 4) : DEFAULT_SYMBOLS;
};

const getMockSignalDirection = (index: number) => (index % 2 === 0 ? "UP" : "DOWN");

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async ({ request }: { request: Request }) => {
  const symbols = resolveRequestedSymbols(request);
  const timestamp = new Date().toISOString();

  const signals = symbols.map((pair, index) => ({
    pair,
    direction: getMockSignalDirection(index),
    strength: 62 + index * 8,
    confidence: 76 + index * 5,
    timeframe: "24H",
    exchange: index % 2 === 0 ? "Binance" : "Coinbase",
    provider: index % 2 === 0 ? "binance" : "coinbase",
    price: index % 2 === 0 ? 68450 + index * 125 : 3520 + index * 22,
    changePct: index % 2 === 0 ? 2.8 + index * 0.6 : -1.2 - index * 0.4,
    bid: index % 2 === 0 ? 68420 + index * 125 : 3516 + index * 22,
    ask: index % 2 === 0 ? 68480 + index * 125 : 3524 + index * 22,
    timestamp,
  })) as Signal[];

  const trades = symbols.map((pair, index) => ({
    id: `tr-${index + 1}`,
    pair,
    type: index % 2 === 0 ? ("BUY" as TradeType) : ("SELL" as TradeType),
    amount: index % 2 === 0 ? 0.18 + index * 0.04 : 1.1 + index * 0.2,
    price: index % 2 === 0 ? 68325 + index * 115 : 3510 + index * 18,
    profit: index % 2 === 0 ? 145.2 - index * 12 : -34.1 + index * 9,
    timestamp,
    status: index === 0 ? ("OPEN" as TradeStatus) : ("CLOSED" as TradeStatus),
    exchange: index % 2 === 0 ? "Binance" : "Coinbase",
    provider: index % 2 === 0 ? "binance" : "coinbase",
    marketPrice: index % 2 === 0 ? 68450 + index * 125 : 3520 + index * 22,
    fee: index % 2 === 0 ? 2.15 : 1.82,
  })) as Trade[];

  const balanceUpdates = [
    {
      id: "bal-binance-1",
      exchange: "Binance",
      provider: "binance" as const,
      asset: "USDT",
      currency: "USDT",
      totalBalance: 15420.5,
      availableBalance: 14320.5,
      lockedBalance: 1100,
      change: 125.35,
      timestamp,
    },
    {
      id: "bal-coinbase-1",
      exchange: "Coinbase",
      provider: "coinbase" as const,
      asset: "USD",
      currency: "USD",
      totalBalance: 8926.82,
      availableBalance: 8542.41,
      lockedBalance: 384.41,
      change: null,
      timestamp,
    },
  ] as BalanceUpdate[];

  const platforms = [
    {
      name: "Binance",
      provider: "binance" as const,
      status: "connected" as const,
      balance: 15420.5,
      currency: "USDT",
      message: "Market and account channels are live.",
      updatedAt: timestamp,
      marketStatus: "connected" as const,
      accountStatus: "connected" as const,
      reconnectAttempts: 0,
      subscribedSymbols: symbols,
    },
    {
      name: "Coinbase",
      provider: "coinbase" as const,
      status: "connected" as const,
      balance: 8926.82,
      currency: "USD",
      message: "Market and account channels are live.",
      updatedAt: timestamp,
      marketStatus: "connected" as const,
      accountStatus: "connected" as const,
      reconnectAttempts: 0,
      subscribedSymbols: symbols,
    },
  ] as Platform[];

  return jsonResponse({
    botStatus: { active: true },
    balances: {
      totalBalance: platforms.reduce((sum, platform) => sum + platform.balance, 0),
      dailyProfit: 1247.85,
      winRate: 78.5,
    },
    trades,
    signals,
    platforms,
    balanceUpdates,
    stream: {
      defaultSymbols: symbols,
      providers: ["binance", "coinbase"],
      reconnectDelayMs: 3000,
    },
  });
};
