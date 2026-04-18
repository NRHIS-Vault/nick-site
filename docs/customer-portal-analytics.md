# Customer Portal Analytics

The customer portal now reads from two Worker endpoints:

- `/customerPortal/plans`
- `/customerPortal/analytics`

Both endpoints share the same normalization layer in `functions/customerPortal/shared.ts`.

## Data source order

The Worker resolves data in this order:

1. Supabase tables
2. Stripe API
3. Built-in stub dataset

### Supabase

If `SUPABASE_URL` and `SUPABASE_KEY` are configured, the Worker first reads:

- `subscription_plans` by default, or `CUSTOMER_PORTAL_PLANS_TABLE`
- `subscriptions` by default, or `CUSTOMER_PORTAL_SUBSCRIPTIONS_TABLE`

The normalizer accepts flexible column names so it can work with common schemas imported from Stripe or hand-authored plan tables.

### Stripe

If Supabase is unavailable or empty and `STRIPE_SECRET_KEY` is configured, the Worker falls back to:

- `GET /v1/products` with `default_price` expanded for plan cards
- `GET /v1/subscriptions` with customer and price/product expansions for analytics

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
