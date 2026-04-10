import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import {
  TradingAuthorizationError,
  requireTradingActionRole,
} from "./auth";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
};

const createRequest = (headers: Record<string, string> = {}) =>
  new Request("https://example.com/trading/orders", {
    method: "POST",
    headers: {
      Authorization: "Bearer access-token",
      ...headers,
    },
  });

describe("trading action auth helper", () => {
  beforeEach(() => {
    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.getUserMock.mockReset();
    supabaseMocks.selectMock.mockReset();
    supabaseMocks.eqMock.mockReset();
    supabaseMocks.maybeSingleMock.mockReset();

    supabaseMocks.getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          app_metadata: {},
          user_metadata: {},
        },
      },
      error: null,
    });
    supabaseMocks.maybeSingleMock.mockResolvedValue({
      data: {
        role: "paid",
      },
      error: null,
    });
    supabaseMocks.eqMock.mockReturnValue({
      maybeSingle: supabaseMocks.maybeSingleMock,
    });
    supabaseMocks.selectMock.mockReturnValue({
      eq: supabaseMocks.eqMock,
    });
    supabaseMocks.fromMock.mockReturnValue({
      select: supabaseMocks.selectMock,
    });
    supabaseMocks.createClientMock.mockReturnValue({
      auth: {
        getUser: supabaseMocks.getUserMock,
      },
      from: supabaseMocks.fromMock,
    });
  });

  it("allows paid users to execute trading actions", async () => {
    const result = await requireTradingActionRole(createRequest(), env);

    expect(result).toMatchObject({
      role: "paid",
      user: {
        id: "user-1",
      },
    });
    expect(supabaseMocks.getUserMock).toHaveBeenCalledWith("access-token");
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("profiles");
  });

  it("rejects non-paid, non-admin roles with a 403", async () => {
    supabaseMocks.maybeSingleMock.mockResolvedValue({
      data: {
        role: "member",
      },
      error: null,
    });

    await expect(requireTradingActionRole(createRequest(), env)).rejects.toMatchObject({
      status: 403,
      code: "TRADING_ACTION_FORBIDDEN",
      message: "Trading actions require a paid or admin role.",
    } satisfies Partial<TradingAuthorizationError>);
  });

  it("rejects requests without a bearer token", async () => {
    await expect(
      requireTradingActionRole(
        createRequest({
          Authorization: "",
        }),
        env
      )
    ).rejects.toMatchObject({
      status: 401,
      code: "TRADING_AUTH_REQUIRED",
      message: "Missing Authorization bearer token.",
    } satisfies Partial<TradingAuthorizationError>);
  });
});
