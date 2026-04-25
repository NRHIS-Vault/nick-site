import {
  billingErrorResponse,
  type BillingEnv,
  BillingRequestError,
  jsonResponse,
  loadCheckoutPlan,
  optionsResponse,
  parseAbsoluteHttpUrl,
  readJsonBody,
  readString,
  requireAuthenticatedUser,
  stripeRequest,
  type StripeCheckoutSession,
} from "./shared";

export const onRequestOptions = optionsResponse;

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: BillingEnv;
}) => {
  try {
    const { user } = await requireAuthenticatedUser(request, env);
    const payload = await readJsonBody(request);
    const plan = await loadCheckoutPlan(env, readString(payload.planId));
    const successUrl = parseAbsoluteHttpUrl(
      readString(payload.successUrl),
      "successUrl"
    );
    const cancelUrl = parseAbsoluteHttpUrl(
      readString(payload.cancelUrl),
      "cancelUrl"
    );

    const lineItemCurrency = plan.currency.toLowerCase();
    const lineItemAmount = Math.round(plan.price * 100);

    if (!Number.isFinite(lineItemAmount) || lineItemAmount <= 0) {
      throw new BillingRequestError(
        500,
        "BILLING_PLAN_INVALID",
        `Plan "${plan.name}" is missing a valid recurring price.`
      );
    }

    const bodyEntries: Array<[string, string]> = [
      ["mode", "subscription"],
      ["success_url", successUrl.toString()],
      ["cancel_url", cancelUrl.toString()],
      ["client_reference_id", user.id],
      ["allow_promotion_codes", "true"],
      ["billing_address_collection", "auto"],
      ["line_items[0][quantity]", "1"],
      ["line_items[0][price_data][currency]", lineItemCurrency],
      ["line_items[0][price_data][unit_amount]", String(lineItemAmount)],
      ["line_items[0][price_data][product_data][name]", plan.name],
      ["line_items[0][price_data][product_data][description]", plan.description],
      ["line_items[0][price_data][recurring][interval]", plan.billingInterval],
      [
        "line_items[0][price_data][recurring][interval_count]",
        String(plan.billingIntervalCount),
      ],
      ["metadata[user_id]", user.id],
      ["metadata[plan_id]", plan.id],
      ["metadata[plan_name]", plan.name],
      ["subscription_data[metadata][user_id]", user.id],
      ["subscription_data[metadata][plan_id]", plan.id],
      ["subscription_data[metadata][plan_name]", plan.name],
    ];

    if (user.email) {
      bodyEntries.push(["customer_email", user.email]);
    }

    const session = await stripeRequest<StripeCheckoutSession>(env, "/checkout/sessions", {
      method: "POST",
      bodyEntries,
    });

    if (!session.id || !session.url) {
      throw new BillingRequestError(
        502,
        "STRIPE_SESSION_INVALID",
        "Stripe did not return a valid checkout session."
      );
    }

    return jsonResponse({
      ok: true,
      mode: "stripe",
      sessionId: session.id,
      checkoutUrl: session.url,
      publishableKey: "",
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        billingIntervalCount: plan.billingIntervalCount,
      },
    });
  } catch (error) {
    return billingErrorResponse(error);
  }
};
