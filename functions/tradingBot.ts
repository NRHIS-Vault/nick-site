// Sample API for TradingBot panel with balances, signals, platforms, and trades.

type TradeType = "BUY" | "SELL";
type TradeStatus = "OPEN" | "CLOSED" | "PENDING";

type Trade = {
  id: string;
  pair: string;
  type: TradeType;
  amount: number;
  price: number;
  profit: number;
  timestamp: string;
  status: TradeStatus;
};

type Signal = {
  pair: string;
  direction: "UP" | "DOWN";
  strength: number;
  confidence: number;
  timeframe: string;
};

type Platform = {
  name: string;
  status: "connected" | "disconnected";
  balance: number;
};

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

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async () => {
  const payload = {
    botStatus: { active: false },
    balances: {
      totalBalance: 25847.32,
      dailyProfit: 1247.85,
      winRate: 78.5,
    },
    trades: [
      { id: "tr-1", pair: "BTC/USDT", type: "BUY" as TradeType, amount: 0.5, price: 43250, profit: 125.5, timestamp: new Date().toISOString(), status: "OPEN" as TradeStatus },
      { id: "tr-2", pair: "ETH/USDT", type: "SELL" as TradeType, amount: 2.1, price: 2650, profit: -45.2, timestamp: new Date().toISOString(), status: "OPEN" as TradeStatus },
      { id: "tr-3", pair: "ADA/USDT", type: "BUY" as TradeType, amount: 1000, price: 0.45, profit: 78.9, timestamp: new Date().toISOString(), status: "OPEN" as TradeStatus },
    ] as Trade[],
    signals: [
      { pair: "BTC/USDT", direction: "UP", strength: 85, confidence: 92, timeframe: "1H" },
      { pair: "ETH/USDT", direction: "DOWN", strength: 72, confidence: 88, timeframe: "4H" },
      { pair: "SOL/USDT", direction: "UP", strength: 68, confidence: 75, timeframe: "15M" },
    ] as Signal[],
    platforms: [
      { name: "Binance", status: "connected" as const, balance: 15420.5 },
      { name: "Coinbase", status: "connected" as const, balance: 8926.82 },
      { name: "KuCoin", status: "disconnected" as const, balance: 1500.0 },
    ] as Platform[],
  };

  return jsonResponse(payload);
};
