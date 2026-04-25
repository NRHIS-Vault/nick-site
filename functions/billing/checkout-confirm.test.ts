import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { onRequestPost } from "./checkout-confirm";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
  STRIPE_SECRET_KEY: "sk_test_123",
};

describe("billing checkout confirmation worker", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.getUserMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.selectMock.mockReset();
    supabaseMocks.eqMock.mockReset();
    supabaseMocks.maybeSingleMock.mockReset();
    supabaseMocks.upsertMock.mockReset();

    supabaseMocks.getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
      error: null,
    });

    supabaseMocks.maybeSingleMock.mockResolvedValue({
      data: {
        role: "member",
      },
      error: null,
    });

    supabaseMocks.eqMock.mockReturnValue({
      maybeSingle: supabaseMocks.maybeSingleMock,
    });

    supabaseMocks.selectMock.mockReturnValue({
      eq: supabaseMocks.eqMock,
    });

    supabaseMocks.fromMock.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: supabaseMocks.selectMock,
          upsert: supabaseMocks.upsertMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    supabaseMocks.upsertMock.mockResolvedValue({
      error: null,
    });

    supabaseMocks.createClientMock.mockReturnValue({
      auth: {
        getUser: supabaseMocks.getUserMock,
      },
      from: supabaseMocks.fromMock,
    });

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_123",
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          client_reference_id: "user-1",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
  });

  it("activates the authenticated user's profile after Stripe confirms the session", async () => {
    const response = await onRequestPost({
      request: new Request("https://example.com/billing/checkout-confirm", {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: "cs_test_123",
        }),
      }),
      env,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_123",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk_test_123",
        }),
      })
    );
    expect(supabaseMocks.upsertMock).toHaveBeenCalledWith(
      {
        id: "user-1",
        role: "paid",
        subscription_status: "active",
      },
      {
        onConflict: "id",
      }
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sessionId: "cs_test_123",
      profile: {
        role: "paid",
        subscriptionStatus: "active",
      },
    });
  });

  it("rejects checkout confirmation when the Stripe session belongs to another user", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "cs_test_123",
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          client_reference_id: "user-2",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    const response = await onRequestPost({
      request: new Request("https://example.com/billing/checkout-confirm", {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: "cs_test_123",
        }),
      }),
      env,
    });

    expect(supabaseMocks.upsertMock).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "BILLING_SESSION_FORBIDDEN",
    });
  });
});
