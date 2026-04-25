import {
  billingErrorResponse,
  type BillingEnv,
  BillingRequestError,
  jsonResponse,
  optionsResponse,
  readJsonBody,
  readString,
  requireAuthenticatedUser,
  stripeRequest,
  type StripeCheckoutSession,
} from "./shared";

type BillingProfileRow = {
  role?: string | null;
};

export const onRequestOptions = optionsResponse;

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: BillingEnv;
}) => {
  try {
    const { supabase, user } = await requireAuthenticatedUser(request, env);
    const payload = await readJsonBody(request);
    const sessionId = readString(payload.sessionId);

    if (!sessionId) {
      throw new BillingRequestError(
        400,
        "BILLING_SESSION_ID_REQUIRED",
        "Missing checkout session id."
      );
    }

    const session = await stripeRequest<StripeCheckoutSession>(
      env,
      `/checkout/sessions/${encodeURIComponent(sessionId)}`
    );

    const metadata = session.metadata ?? {};
    const ownerId =
      readString(session.client_reference_id) ?? readString(metadata.user_id);

    if (!ownerId || ownerId !== user.id) {
      throw new BillingRequestError(
        403,
        "BILLING_SESSION_FORBIDDEN",
        "The checkout session does not belong to the authenticated user."
      );
    }

    const sessionMode = readString(session.mode)?.toLowerCase() ?? null;
    const sessionStatus = readString(session.status)?.toLowerCase() ?? null;
    const paymentStatus = readString(session.payment_status)?.toLowerCase() ?? null;

    if (sessionMode !== "subscription") {
      throw new BillingRequestError(
        409,
        "BILLING_SESSION_INVALID",
        "The checkout session is not a subscription checkout."
      );
    }

    if (sessionStatus !== "complete" && paymentStatus !== "paid") {
      throw new BillingRequestError(
        409,
        "BILLING_SESSION_INCOMPLETE",
        "The checkout session has not completed yet."
      );
    }

    const { data: existingProfile, error: lookupError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (lookupError) {
      throw new BillingRequestError(
        500,
        "BILLING_PROFILE_LOOKUP_FAILED",
        "Unable to load the billing profile for the authenticated user."
      );
    }

    const currentRole =
      readString((existingProfile as BillingProfileRow | null)?.role)?.toLowerCase() ??
      null;
    const nextRole = currentRole === "admin" ? "admin" : "paid";

    const { error: upsertError } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        role: nextRole,
        subscription_status: "active",
      },
      {
        onConflict: "id",
      }
    );

    if (upsertError) {
      throw new BillingRequestError(
        500,
        "BILLING_PROFILE_UPDATE_FAILED",
        "Unable to activate the user's subscription profile."
      );
    }

    return jsonResponse({
      ok: true,
      sessionId,
      profile: {
        role: nextRole,
        subscriptionStatus: "active",
      },
    });
  } catch (error) {
    return billingErrorResponse(error);
  }
};
