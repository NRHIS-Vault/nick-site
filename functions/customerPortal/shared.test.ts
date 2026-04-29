import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { onRequestGet as onRequestGetAnalytics } from "./analytics";
import { onRequestGet as onRequestGetPlans } from "./plans";
import {
  buildCustomerPortalAnalytics,
  computeMonthlyRecurringRevenue,
  loadSubscribers,
  type PortalPlan,
  type PortalSubscriber,
} from "./shared";

describe("customer portal analytics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.selectMock.mockReset();

    supabaseMocks.createClientMock.mockReturnValue({
      from: supabaseMocks.fromMock,
    });

    supabaseMocks.fromMock.mockReturnValue({
      select: supabaseMocks.selectMock,
    });
  });

  it("normalizes recurring revenue into monthly values", () => {
    expect(
      computeMonthlyRecurringRevenue({
        amount: 1200,
        billingInterval: "year",
        billingIntervalCount: 1,
      })
    ).toBe(100);

    expect(
      computeMonthlyRecurringRevenue({
        amount: 25,
        billingInterval: "week",
        billingIntervalCount: 1,
        quantity: 2,
      })
    ).toBeCloseTo(216.67, 2);
  });

  it("aggregates active subscribers, MRR, and plan rollups from plan and subscription snapshots", () => {
    const plans: PortalPlan[] = [
      {
        id: "starter",
        name: "Starter",
        description: "Entry plan",
        price: 50,
        currency: "usd",
        billingInterval: "month",
        billingIntervalCount: 1,
        billingPeriodLabel: "month",
        monthlyPriceEquivalent: 50,
        features: ["Signals"],
        popular: false,
        roi: "Baseline",
      },
      {
        id: "pro",
        name: "Pro",
        description: "Growth plan",
        price: 120,
        currency: "usd",
        billingInterval: "month",
        billingIntervalCount: 1,
        billingPeriodLabel: "month",
        monthlyPriceEquivalent: 120,
        features: ["Signals", "Automation"],
        popular: true,
        roi: "Higher automation leverage",
      },
    ];

    const subscribers: PortalSubscriber[] = [
      {
        id: "sub-1",
        name: "Alice",
        email: "alice@example.com",
        planId: "starter",
        planName: "Starter",
        joinDate: "2026-02-10T00:00:00.000Z",
        status: "active",
        amount: 50,
        currency: "usd",
        quantity: 1,
        billingInterval: "month",
        billingIntervalCount: 1,
        monthlyRecurringRevenue: 50,
        items: [
          {
            planId: "starter",
            planName: "Starter",
            quantity: 1,
            amount: 50,
            currency: "usd",
            billingInterval: "month",
            billingIntervalCount: 1,
            monthlyRecurringRevenue: 50,
          },
        ],
      },
      {
        id: "sub-2",
        name: "Bob",
        email: "bob@example.com",
        planId: "pro",
        planName: "Pro",
        joinDate: "2026-03-05T00:00:00.000Z",
        status: "trialing",
        amount: 120,
        currency: "usd",
        quantity: 1,
        billingInterval: "month",
        billingIntervalCount: 1,
        monthlyRecurringRevenue: 120,
        items: [
          {
            planId: "pro",
            planName: "Pro",
            quantity: 1,
            amount: 120,
            currency: "usd",
            billingInterval: "month",
            billingIntervalCount: 1,
            monthlyRecurringRevenue: 120,
          },
        ],
      },
      {
        id: "sub-3",
        name: "Cara",
        email: "cara@example.com",
        planId: "pro",
        planName: "Pro",
        joinDate: "2026-04-01T00:00:00.000Z",
        status: "cancelled",
        amount: 120,
        currency: "usd",
        quantity: 1,
        billingInterval: "month",
        billingIntervalCount: 1,
        monthlyRecurringRevenue: 120,
        items: [
          {
            planId: "pro",
            planName: "Pro",
            quantity: 1,
            amount: 120,
            currency: "usd",
            billingInterval: "month",
            billingIntervalCount: 1,
            monthlyRecurringRevenue: 120,
          },
        ],
      },
    ];

    const payload = buildCustomerPortalAnalytics({
      plans,
      planSource: "supabase",
      subscribers,
      subscriberSource: "supabase",
    });

    expect(payload.source).toBe("supabase");
    expect(payload.overview).toEqual({
      activeSubscribers: 2,
      totalSubscribers: 3,
      mrr: 170,
      arr: 2040,
      averageRevenuePerActiveSubscriber: 85,
      trialSubscribers: 1,
      atRiskSubscribers: 0,
    });
    expect(payload.statusBreakdown).toEqual(
      expect.arrayContaining([
        { status: "active", count: 1 },
        { status: "trialing", count: 1 },
        { status: "cancelled", count: 1 },
      ])
    );
    expect(payload.planBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planId: "starter",
          activeSubscribers: 1,
          mrr: 50,
          averageMrr: 50,
        }),
        expect.objectContaining({
          planId: "pro",
          activeSubscribers: 1,
          mrr: 120,
          averageMrr: 120,
        }),
      ])
    );
    expect(payload.notes[0]).toContain("MRR");
  });

  it("maps customer_subscriptions rows with joined service_plans into subscriber analytics records", async () => {
    supabaseMocks.selectMock.mockResolvedValue({
      data: [
        {
          id: "subscription-1",
          subscriber_name: "Alice Carter",
          subscriber_email: "alice@example.com",
          service_plan_id: "plan-1",
          revenue: 799,
          status: "active",
          joined_at: "2026-04-20",
          service_plan: {
            id: "plan-1",
            name: "RHNIS Identity Suite",
            period: "monthly",
            price: 799,
            currency: "usd",
          },
        },
      ],
      error: null,
    });

    const result = await loadSubscribers({
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_KEY: "service-role-key",
      CUSTOMER_PORTAL_STRICT_MODE: "false",
    });

    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("customer_subscriptions");
    expect(supabaseMocks.selectMock).toHaveBeenCalledWith("*, service_plan:service_plan_id(*)");
    expect(result.source).toBe("supabase");
    expect(result.subscribers).toEqual([
      expect.objectContaining({
        id: "subscription-1",
        name: "Alice Carter",
        email: "alice@example.com",
        planId: "plan-1",
        planName: "RHNIS Identity Suite",
        status: "active",
        amount: 799,
        currency: "usd",
        billingInterval: "month",
        billingIntervalCount: 1,
        monthlyRecurringRevenue: 799,
      }),
    ]);
  });

  it("returns a 503 response when strict customer portal plan data is unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response("upstream unavailable", {
        status: 502,
        statusText: "Bad Gateway",
      })
    );

    const response = await onRequestGetPlans({
      env: {
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "CUSTOMER_PORTAL_PLANS_UNAVAILABLE",
    });
  });

  it("returns stub analytics when no external data source is configured", async () => {
    const response = await onRequestGetAnalytics({
      request: new Request("https://example.com/customerPortal/analytics"),
      env: {},
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.source).toBe("stub");
    expect(body.overview.activeSubscribers).toBeGreaterThan(0);
    expect(body.planBreakdown.length).toBeGreaterThan(0);
    expect(body.notes.join(" ")).toContain("stub");
  });
});
