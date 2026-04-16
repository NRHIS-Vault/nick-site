import { describe, expect, it } from "vitest";

import { onRequestGet } from "./analytics";
import {
  buildCustomerPortalAnalytics,
  computeMonthlyRecurringRevenue,
  type PortalPlan,
  type PortalSubscriber,
} from "./shared";

describe("customer portal analytics", () => {
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

  it("returns stub analytics when no external data source is configured", async () => {
    const response = await onRequestGet({
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
