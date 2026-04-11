import { beforeEach, describe, expect, it, vi } from "vitest";

const ccxtMocks = vi.hoisted(() => {
  const exchange = {
    fetchBalance: vi.fn(),
    fetchOpenOrders: vi.fn(),
    fetchMyTrades: vi.fn(),
    setSandboxMode: vi.fn(),
  };
  const binanceConstructor = vi.fn(function MockBinanceExchange() {
    return exchange;
  });

  class RateLimitExceeded extends Error {}
  class DDoSProtection extends Error {}
  class AuthenticationError extends Error {}
  class PermissionDenied extends Error {}
  class AccountNotEnabled extends Error {}
  class AccountSuspended extends Error {}
  class BadSymbol extends Error {}
  class NotSupported extends Error {}
  class NetworkError extends Error {}
  class ExchangeNotAvailable extends Error {}
  class RequestTimeout extends Error {}

  return {
    exchange,
    binanceConstructor,
    RateLimitExceeded,
    DDoSProtection,
    AuthenticationError,
    PermissionDenied,
    AccountNotEnabled,
    AccountSuspended,
    BadSymbol,
    NotSupported,
    NetworkError,
    ExchangeNotAvailable,
    RequestTimeout,
  };
});

vi.mock("ccxt", () => ({
  exchanges: ["binance"],
  binance: ccxtMocks.binanceConstructor,
  RateLimitExceeded: ccxtMocks.RateLimitExceeded,
  DDoSProtection: ccxtMocks.DDoSProtection,
  AuthenticationError: ccxtMocks.AuthenticationError,
  PermissionDenied: ccxtMocks.PermissionDenied,
  AccountNotEnabled: ccxtMocks.AccountNotEnabled,
  AccountSuspended: ccxtMocks.AccountSuspended,
  BadSymbol: ccxtMocks.BadSymbol,
  NotSupported: ccxtMocks.NotSupported,
  NetworkError: ccxtMocks.NetworkError,
  ExchangeNotAvailable: ccxtMocks.ExchangeNotAvailable,
  RequestTimeout: ccxtMocks.RequestTimeout,
}));

import { onRequestGet as onBalancesGet } from "./balances";
import { onRequestGet as onOrdersGet } from "./orders";
import { onRequestGet as onTradesGet } from "./trades";

const createEnv = () => ({
  BINANCE_API_KEY: "binance-key",
  BINANCE_SECRET: "binance-secret",
  BINANCE_SANDBOX: "true",
});

describe("trading read workers", () => {
  beforeEach(() => {
    ccxtMocks.binanceConstructor.mockClear();
    ccxtMocks.exchange.fetchBalance.mockReset();
    ccxtMocks.exchange.fetchOpenOrders.mockReset();
    ccxtMocks.exchange.fetchMyTrades.mockReset();
    ccxtMocks.exchange.setSandboxMode.mockReset();
  });

  it("fetches balances through the mocked ccxt client", async () => {
    // This keeps the worker on the normalized ccxt surface without requiring real
    // exchange credentials or a live outbound network call during unit tests.
    ccxtMocks.exchange.fetchBalance.mockResolvedValueOnce({
      total: { USDT: 1300 },
      free: { USDT: 1250.5 },
      used: { USDT: 49.5 },
    });

    const response = await onBalancesGet({
      env: createEnv(),
    });

    expect(ccxtMocks.binanceConstructor).toHaveBeenCalledWith({
      apiKey: "binance-key",
      secret: "binance-secret",
      enableRateLimit: true,
      options: {
        adjustForTimeDifference: true,
      },
    });
    expect(ccxtMocks.exchange.setSandboxMode).toHaveBeenCalledWith(true);
    expect(ccxtMocks.exchange.fetchBalance).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      exchange: "binance",
      balances: {
        total: { USDT: 1300 },
      },
    });
  });

  it("fetches open orders with parsed since and clamped limit values", async () => {
    ccxtMocks.exchange.fetchOpenOrders.mockResolvedValueOnce([
      {
        id: "order-1",
        symbol: "BTC/USDT",
        status: "open",
      },
    ]);

    const response = await onOrdersGet({
      request: new Request(
        "https://example.com/trading/orders?symbol=BTC/USDT&since=2026-04-10T12:00:00.000Z&limit=250"
      ),
      env: createEnv(),
    });

    expect(ccxtMocks.exchange.fetchOpenOrders).toHaveBeenCalledWith(
      "BTC/USDT",
      Date.parse("2026-04-10T12:00:00.000Z"),
      100
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      exchange: "binance",
      symbol: "BTC/USDT",
      count: 1,
      orders: [
        {
          id: "order-1",
          symbol: "BTC/USDT",
        },
      ],
    });
  });

  it("fetches account trades with the resolved default symbol", async () => {
    ccxtMocks.exchange.fetchMyTrades.mockResolvedValueOnce([
      {
        id: "trade-1",
        symbol: "ETH/USD",
        side: "buy",
      },
    ]);

    const response = await onTradesGet({
      request: new Request(
        "https://example.com/trading/trades?since=1710000000000&limit=20"
      ),
      env: {
        ...createEnv(),
        TRADING_DEFAULT_SYMBOL: "ETH/USD",
      },
    });

    expect(ccxtMocks.exchange.fetchMyTrades).toHaveBeenCalledWith(
      "ETH/USD",
      1_710_000_000_000,
      20
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      exchange: "binance",
      symbol: "ETH/USD",
      since: 1_710_000_000_000,
      limit: 20,
      count: 1,
      trades: [
        {
          id: "trade-1",
          symbol: "ETH/USD",
        },
      ],
    });
  });
});
