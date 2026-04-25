import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getUserMock: vi.fn(),
}));

const customerPortalMocks = vi.hoisted(() => ({
  loadPlansMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

vi.mock("../customerPortal/shared", () => ({
  loadPlans: customerPortalMocks.loadPlansMock,
}));

import { onRequestPost } from "./checkout-session";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
  STRIPE_SECRET_KEY: "sk_test_123",
};

describe("billing checkout session worker", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.getUserMock.mockReset();
    customerPortalMocks.loadPlansMock.mockReset();

    supabaseMocks.getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
      error: null,
    });

    supabaseMocks.createClientMock.mockReturnValue({
      auth: {
        getUser: supabaseMocks.getUserMock,
      },
    });

    customerPortalMocks.loadPlansMock.mockResolvedValue({
      source: "stub",
      notes: [],
      plans: [
        {
          id: "automation-starter",
          name: "Automation Starter",
          description: "Lead capture, chat, and worker controls.",
          price: 49,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          billingPeriodLabel: "month",
          monthlyPriceEquivalent: 49,
          features: ["AI chat assistant"],
          popular: true,
          roi: "Operational savings",
        },
      ],
    });

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_123",
          url: "https://checkout.stripe.com/pay/cs_test_123",
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

  it("creates a Stripe Checkout session for the authenticated user", async () => {
    const response = await onRequestPost({
      request: new Request("https://example.com/billing/checkout-session", {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planId: "automation-starter",
          successUrl:
            "https://dashboard.nick.test/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}",
          cancelUrl: "https://dashboard.nick.test/dashboard?checkout=cancelled",
        }),
      }),
      env,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/checkout/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk_test_123",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
        body: expect.stringContaining("client_reference_id=user-1"),
      })
    );

    const stripeRequest = fetchMock.mock.calls[0]?.[1];
    expect(String(stripeRequest.body)).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=4900");
    expect(String(stripeRequest.body)).toContain("metadata%5Bplan_id%5D=automation-starter");

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mode: "stripe",
      sessionId: "cs_test_123",
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test_123",
      plan: {
        id: "automation-starter",
        price: 49,
      },
    });
  });

  it("rejects unauthenticated checkout session requests", async () => {
    const response = await onRequestPost({
      request: new Request("https://example.com/billing/checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          successUrl: "https://dashboard.nick.test/dashboard?checkout=success",
          cancelUrl: "https://dashboard.nick.test/dashboard?checkout=cancelled",
        }),
      }),
      env,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "BILLING_AUTH_REQUIRED",
    });
  });
});
