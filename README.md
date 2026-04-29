# nick-site

Cloudflare Pages application that serves the public marketing site and the backend API consumed by `nick-frontend`.

## Responsibilities

- Public landing page, contact form, and newsletter signup
- Authenticated worker API for billing, customer portal, chat, RHNIS identity, lead intake, trading, and NCS control/status
- Queue consumer worker for NCS pause/resume requests

## Routes

Public site:

- `/`

Pages Functions:

- `POST /contact`
- `POST /newsletter`
- `GET /customerPortal`
- `GET /customerPortal/plans`
- `GET /customerPortal/analytics`
- `POST /billing/checkout-session`
- `POST /billing/checkout-confirm`
- `POST /chat`
- `GET /chat-history`
- `GET /identity`
- `GET /rhnisIdentity`
- `GET /leadBot`
- `GET /lead-stream`
- `POST /trading/save-keys`
- `GET /trading/balances`
- `GET /trading/orders`
- `POST /trading/orders`
- `DELETE /trading/orders`
- `GET /trading/trades`
- `GET /trading/stream`
- `GET /tradingBot`
- `GET /workers`
- `GET /ncs/status`
- `POST /ncs/pause`
- `POST /ncs/resume`
- `POST /webhooks/meta`
- `GET /webhooks/meta`
- `POST /webhooks/instagram`
- `GET /webhooks/instagram`
- `POST /webhooks/tiktok`

## Billing and Subscription Activation

- `/customerPortal/plans` is the canonical plan source for the paywall.
- `/billing/checkout-session` resolves a plan server-side and creates a Stripe Checkout Session.
- `/billing/checkout-confirm` validates the completed session against Stripe, then updates `public.profiles` so the dashboard unlocks.
- The confirm route activates the initial purchase path. If you need ongoing synchronization for renewals, cancellations, refunds, or delinquency, add a Stripe webhook or a recurring reconciliation job.

Detailed API notes: [docs/billing-checkout.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/billing-checkout.md)

## Environment

Client-side:

- [`.env.example`](/Users/josias/Documents/Projects/nick-git/nick-site/.env.example): `VITE_API_BASE`, `VITE_DASHBOARD_URL`, `VITE_MARKETING_SITE_URL`, `VITE_CONTACT_EMAIL`

Server-side:

- [`.dev.vars.example`](/Users/josias/Documents/Projects/nick-git/nick-site/.dev.vars.example) is the full local runtime contract
- Core worker secrets: `SUPABASE_URL`, `SUPABASE_KEY`
- Billing: `STRIPE_SECRET_KEY`
- Chat providers: `OPENAI_*`, `ANTHROPIC_*`
- Observability: `LOG_*`
- Customer portal controls: `CUSTOMER_PORTAL_*`
- NCS external source override: `NCS_STATUS_*`
- Trading: `TRADING_*`, `BINANCE_*`, `COINBASE_*`
- Social lead intake: `META_*`, `INSTAGRAM_*`, `TIKTOK_*`

For production, leave `CUSTOMER_PORTAL_STRICT_MODE=true` so plan and subscription reads fail loudly if Stripe is unavailable instead of silently serving stub data.

Cloudflare bindings configured in [wrangler.toml](/Users/josias/Documents/Projects/nick-git/nick-site/wrangler.toml):

- `NCS_CONTROL_QUEUE`
- `WORKER_ANALYTICS`

## Supabase Migrations

Apply the matching SQL from [nick-frontend/supabase/migrations](/Users/josias/Documents/Projects/nick-git/nick-frontend/supabase/migrations):

- `20260320_create_profiles.sql`
- `20260326_chat_persistence.sql`
- `20260401_social_leads.sql`
- `20260408_exchange_keys.sql`
- `20260428_ncs_workers_and_realtime.sql`
- `20260320_full_platform_schema.sql`

## Local Development

Site only:

```bash
npm install
npm run dev
```

Full Pages Functions path:

```bash
npm run build
npx wrangler pages dev dist --port 8788
```

## Testing

Run all worker tests:

```bash
npm test
```

Useful focused suites:

```bash
npm test -- functions/billing/checkout-session.test.ts functions/billing/checkout-confirm.test.ts
npm test -- functions/chat.test.ts
npm test -- functions/customerPortal/shared.test.ts
npm test -- functions/leadbot/platforms.test.ts
npm test -- functions/webhooks/handlers.test.ts
npm test -- functions/trading/read-workers.test.ts
npm test -- functions/ncs/consumer.test.ts
```

Build verification:

```bash
npm run build
```

## Deployment

- Deploy the Pages application with [wrangler.toml](/Users/josias/Documents/Projects/nick-git/nick-site/wrangler.toml).
- Deploy the queue consumer separately with [wrangler.ncs-consumer.toml](/Users/josias/Documents/Projects/nick-git/nick-site/wrangler.ncs-consumer.toml).
- GitHub Actions deployment for this repo lives in [`.github/workflows/deploy.yml`](/Users/josias/Documents/Projects/nick-git/nick-site/.github/workflows/deploy.yml).
- Sync secrets for both runtimes before production traffic.
- Verify `public.social_leads` is present in the `supabase_realtime` publication before relying on `/lead-stream`.

## Supporting Docs

- [docs/billing-checkout.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/billing-checkout.md)
- [docs/customer-portal-analytics.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/customer-portal-analytics.md)
- [docs/identity-service.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/identity-service.md)
- [docs/ncs-architecture.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/ncs-architecture.md)
- [docs/ncs-control-queue.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/ncs-control-queue.md)
- [docs/social-webhooks.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/social-webhooks.md)
- [docs/worker-observability.md](/Users/josias/Documents/Projects/nick-git/nick-site/docs/worker-observability.md)
