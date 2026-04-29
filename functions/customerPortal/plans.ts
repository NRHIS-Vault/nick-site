import {
  customerPortalErrorResponse,
  type CustomerPortalEnv,
  jsonResponse,
  loadPlans,
  optionsResponse,
} from "./shared";

export const onRequestOptions = optionsResponse;

export const onRequestGet = async ({ env }: { env: CustomerPortalEnv }) => {
  try {
    const plans = await loadPlans(env);

    return jsonResponse({
      source: plans.source,
      updatedAt: new Date().toISOString(),
      plans: plans.plans,
    });
  } catch (error) {
    return customerPortalErrorResponse(error);
  }
};
