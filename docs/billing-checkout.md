# Billing Checkout API

`nick-site` exposes two authenticated billing routes:

- `POST /billing/checkout-session`
- `POST /billing/checkout-confirm`

Both routes expect a real Supabase bearer token in `Authorization: Bearer <access-token>`.

## `POST /billing/checkout-session`

Creates a Stripe Checkout Session for one normalized customer-portal plan.

### Request body

```json
{
  "planId": "lead-generation-pro",
  "successUrl": "https://dashboard.example.com/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://dashboard.example.com/dashboard?checkout=cancelled"
}
```

### Behavior

1. Validates the authenticated Supabase user.
2. Resolves `planId` through the same `loadPlans()` normalization layer used by `/customerPortal/plans`.
3. Validates the redirect URLs as absolute `http` or `https` URLs.
4. Creates a Stripe subscription-mode Checkout Session with:
   - `client_reference_id = auth.users.id`
   - plan metadata on both the Checkout Session and subscription
   - recurring `price_data` generated from the normalized plan payload

### Success response

```json
{
  "ok": true,
  "mode": "stripe",
  "sessionId": "cs_test_123",
  "checkoutUrl": "https://checkout.stripe.com/pay/...",
  "publishableKey": "",
  "plan": {
    "id": "lead-generation-pro",
    "name": "Lead Generation Pro",
    "price": 197,
    "currency": "usd",
    "billingInterval": "month",
    "billingIntervalCount": 1
  }
}
```

## `POST /billing/checkout-confirm`

Confirms a completed Stripe Checkout Session and updates `public.profiles` so the dashboard unlocks.

### Request body

```json
{
  "sessionId": "cs_test_123"
}
```

### Behavior

1. Validates the authenticated Supabase user.
2. Fetches the Checkout Session from Stripe with `STRIPE_SECRET_KEY`.
3. Verifies that the session belongs to the authenticated user by checking `client_reference_id` or `metadata.user_id`.
4. Verifies the session completed successfully.
5. Upserts `public.profiles` for the user:
   - `subscription_status = 'active'`
   - `role = 'paid'` unless the existing role is already `admin`

### Success response

```json
{
  "ok": true,
  "sessionId": "cs_test_123",
  "profile": {
    "role": "paid",
    "subscriptionStatus": "active"
  }
}
```

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `STRIPE_SECRET_KEY`

## Frontend flow

`nick-frontend/src/components/Paywall.tsx` uses the routes like this:

1. Fetch `/customerPortal/plans`.
2. Start `/billing/checkout-session` for the featured plan.
3. Redirect to Stripe.
4. On return, call `/billing/checkout-confirm`.
5. Reload the dashboard so `AuthContext` rehydrates the updated profile.

## Operational note

The confirm route activates access for a successful checkout, but it is not a full recurring-billing sync system. If you need automatic handling for renewals, cancellations, refunds, or past-due transitions, add a Stripe webhook or another recurring reconciliation path that updates `public.profiles.subscription_status`.
