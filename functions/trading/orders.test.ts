import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeMocks = vi.hoisted(() => ({
  createOrderMock: vi.fn(),
  cancelOrderMock: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  requireTradingActionRoleMock: vi.fn(),
}));

vi.mock("./shared", () => ({
  createExchangeClient: vi.fn(() => ({
    exchange: {
      createOrder: exchangeMocks.createOrderMock,
      cancelOrder: exchangeMocks.cancelOrderMock,
    },
    exchangeId: "binance",
  })),
  exchangeErrorResponse: vi.fn((error: unknown) =>
    new Response(
      JSON.stringify({
        ok: false,
        code: "EXCHANGE_ERROR",
        error: error instanceof Error ? error.message : "Unknown exchange error",
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
  ),
  getOptionalLimit: vi.fn(() => 50),
  getOptionalSince: vi.fn(() => undefined),
  getOptionalSymbol: vi.fn(() => "BTC/USDT"),
  jsonResponse: vi.fn((body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    })
  ),
  optionsResponse: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock("./auth", () => {
  class TradingAuthorizationError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "TradingAuthorizationError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    TradingAuthorizationError,
    requireTradingActionRole: authMocks.requireTradingActionRoleMock,
  };
});

import { TradingAuthorizationError } from "./auth";
import { onRequestDelete, onRequestPost } from "./orders";

const env = {
  BINANCE_API_KEY: "binance-key",
  BINANCE_SECRET: "binance-secret",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
};

describe("trading orders worker", () => {
  beforeEach(() => {
    exchangeMocks.createOrderMock.mockReset();
    exchangeMocks.cancelOrderMock.mockReset();
    authMocks.requireTradingActionRoleMock.mockReset();

    authMocks.requireTradingActionRoleMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
      role: "paid",
    });
    exchangeMocks.createOrderMock.mockResolvedValue({
      id: "order-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
    });
    exchangeMocks.cancelOrderMock.mockResolvedValue({
      id: "order-1",
      status: "canceled",
    });
  });

  it("places an order only after the role gate passes", async () => {
    const response = await onRequestPost({
      request: new Request("https://example.com/trading/orders", {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: "BTC/USDT",
          side: "BUY",
          amount: 0.25,
        }),
      }),
      env,
    });

    expect(authMocks.requireTradingActionRoleMock).toHaveBeenCalledTimes(1);
    expect(exchangeMocks.createOrderMock).toHaveBeenCalledWith(
      "BTC/USDT",
      "market",
      "buy",
      0.25,
      undefined
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: "create",
      exchange: "binance",
      symbol: "BTC/USDT",
      side: "BUY",
      executedBy: {
        userId: "user-1",
        role: "paid",
      },
    });
  });

  it("returns 403 and skips the exchange mutation when the user lacks the required role", async () => {
    authMocks.requireTradingActionRoleMock.mockRejectedValueOnce(
      new TradingAuthorizationError(
        403,
        "TRADING_ACTION_FORBIDDEN",
        "Trading actions require a paid or admin role."
      )
    );

    const response = await onRequestPost({
      request: new Request("https://example.com/trading/orders", {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: "BTC/USDT",
          side: "BUY",
          amount: 0.25,
        }),
      }),
      env,
    });

    expect(exchangeMocks.createOrderMock).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "TRADING_ACTION_FORBIDDEN",
      error: "Trading actions require a paid or admin role.",
    });
  });

  it("cancels an order for an authorized user", async () => {
    authMocks.requireTradingActionRoleMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
      role: "admin",
    });

    const response = await onRequestDelete({
      request: new Request("https://example.com/trading/orders", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: "order-1",
          symbol: "BTC/USDT",
        }),
      }),
      env,
    });

    expect(exchangeMocks.cancelOrderMock).toHaveBeenCalledWith("order-1", "BTC/USDT");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: "cancel",
      orderId: "order-1",
      executedBy: {
        userId: "user-1",
        role: "admin",
      },
    });
  });
});
