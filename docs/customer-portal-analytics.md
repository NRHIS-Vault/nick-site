# Customer Portal Analytics

The customer portal now reads from two Worker endpoints:

- `/customerPortal/plans`
- `/customerPortal/analytics`

Both endpoints share the same normalization layer in `functions/customerPortal/shared.ts`.

The billing checkout routes reuse the same plan loader, so the paywall, plan cards, analytics, and Stripe Checkout all resolve from one canonical normalization path.

## Data source order

The Worker resolves data in this order:

1. Stripe API
2. Supabase tables
3. Built-in stub dataset

When `CUSTOMER_PORTAL_STRICT_MODE=true` or `STRIPE_SECRET_KEY` is present, Stripe becomes the live source of truth and the Worker stops falling back to stub data. That is the intended production behavior for this workspace.

### Stripe

If `STRIPE_SECRET_KEY` is configured, the Worker reads:

- `GET /v1/products` with `default_price` expanded for plan cards
- `GET /v1/subscriptions` with customer and price/product expansions for analytics

### Supabase

If `SUPABASE_URL` and `SUPABASE_KEY` are configured and strict Stripe mode is disabled, the Worker can read:

- `service_plans` by default, or `CUSTOMER_PORTAL_PLANS_TABLE`
- `customer_subscriptions` by default, or `CUSTOMER_PORTAL_SUBSCRIPTIONS_TABLE`

For the default schema, subscription reads also join `service_plan:service_plan_id(*)` so analytics can recover plan name, interval, and pricing metadata from the related plan row.

The normalizer still accepts flexible column names so it can work with common schemas mirrored from Stripe or hand-authored plan tables.

## Metric definitions

Analytics are computed from the current subscription snapshot, not invoice history.

- `activeSubscribers`: subscriptions with status `active`, `trialing`, or `past_due`
- `MRR`: sum of normalized monthly recurring revenue for active subscribers
- `ARR`: `MRR * 12`
- `averageRevenuePerActiveSubscriber`: `MRR / activeSubscribers`
- `atRiskSubscribers`: subscriptions with status `past_due` or `unpaid`

### MRR normalization

Recurring amounts are normalized to a monthly basis before aggregation:

- daily: `amount * 30.4375 / interval_count`
- weekly: `amount * 52 / 12 / interval_count`
- monthly: `amount / interval_count`
- yearly: `amount / 12 / interval_count`

Stripe item quantities are included in the normalized amount. For Supabase rows, the Worker prefers an explicit total recurring amount when present and otherwise derives one from unit pricing.

## Charts

The frontend renders:

- plan MRR by plan
- subscriber status distribution
- new subscribers by start month

The monthly trend uses subscription start dates plus the current recurring value on each subscription because the Worker does not query invoices or revenue-recognition data.

## Frontend verification

- `nick-frontend/src/components/CustomerPortal.test.tsx` mocks both customer portal endpoints and verifies that the dashboard renders sample revenue metrics, plan cards, subscriber rows, and analytics notes from the normalized payloads.
- `nick-site/functions/customerPortal/shared.test.ts` covers strict-mode failure behavior plus the `customer_subscriptions` + `service_plans` Supabase normalization path.
