import {
  buildCustomerPortalAnalytics,
  customerPortalErrorResponse,
  type CustomerPortalEnv,
  jsonResponse,
  loadPlans,
  loadSubscribers,
  optionsResponse,
} from "./customerPortal/shared";

export const onRequestOptions = optionsResponse;

export const onRequestGet = async ({ env }: { env: CustomerPortalEnv }) => {
  try {
    const [plansResult, subscribersResult] = await Promise.all([
      loadPlans(env),
      loadSubscribers(env),
    ]);

    return jsonResponse({
      source:
        plansResult.source === subscribersResult.source
          ? plansResult.source
          : "mixed",
      computedAt: new Date().toISOString(),
      plans: plansResult.plans,
      analytics: buildCustomerPortalAnalytics({
        plans: plansResult.plans,
        planSource: plansResult.source,
        subscribers: subscribersResult.subscribers,
        subscriberSource: subscribersResult.source,
        notes: [...plansResult.notes, ...subscribersResult.notes],
      }),
    });
  } catch (error) {
    return customerPortalErrorResponse(error);
  }
};
