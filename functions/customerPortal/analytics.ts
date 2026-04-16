import {
  buildCustomerPortalAnalytics,
  type CustomerPortalEnv,
  jsonResponse,
  loadPlans,
  loadSubscribers,
  optionsResponse,
} from "./shared";

export const onRequestOptions = optionsResponse;

export const onRequestGet = async ({ env }: { env: CustomerPortalEnv }) => {
  const [plansResult, subscribersResult] = await Promise.all([
    loadPlans(env),
    loadSubscribers(env),
  ]);

  return jsonResponse(
    buildCustomerPortalAnalytics({
      plans: plansResult.plans,
      planSource: plansResult.source,
      subscribers: subscribersResult.subscribers,
      subscriberSource: subscribersResult.source,
      notes: [...plansResult.notes, ...subscribersResult.notes],
    })
  );
};
