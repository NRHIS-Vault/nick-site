# Social Webhook Setup

Webhook routes live under Cloudflare Pages Functions:

- `POST /webhooks/meta`
- `GET /webhooks/meta` for Meta verification
- `POST /webhooks/instagram`
- `GET /webhooks/instagram` for Instagram verification
- `POST /webhooks/tiktok`

All three handlers validate the provider signature before parsing JSON. Valid lead-like payloads are normalized into `public.social_leads` with:

- `id`
- `platform`
- `campaign_id`
- `lead_data`
- `received_at`

Apply the database migration before turning any webhook on:

```bash
nick-frontend/supabase/migrations/20260401_social_leads.sql
```

## Required server secrets

Set these in Cloudflare Pages or in `nick-site/.dev.vars` for local `wrangler pages dev` runs:

```bash
SUPABASE_URL=
SUPABASE_KEY=

META_APP_SECRET=
META_VERIFY_TOKEN=

INSTAGRAM_APP_SECRET=
INSTAGRAM_VERIFY_TOKEN=

TIKTOK_APP_SECRET=
```

## Meta

1. In the Meta App Dashboard, add the Webhooks product and subscribe to the Page object for the lead-related fields you need.
2. Set the callback URL to `https://<your-domain>/webhooks/meta`.
3. Set the verify token to the same value as `META_VERIFY_TOKEN`.
4. Keep `META_APP_SECRET` server-side only. The handler computes an HMAC over the raw request body and compares it to `X-Hub-Signature` before JSON parsing.
5. After the callback verifies, complete the usual Page/App subscription flow so Meta can actually deliver leadgen events.

Reference:

- `https://developers.facebook.com/docs/graph-api/webhooks/getting-started`
- `https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/`

## Instagram

1. Configure the webhook in the same Meta App Dashboard used for your Instagram app.
2. Use `https://<your-domain>/webhooks/instagram` as the callback URL.
3. Use the same value in the dashboard and `INSTAGRAM_VERIFY_TOKEN`.
4. Keep `INSTAGRAM_APP_SECRET` server-side only. The handler validates `X-Hub-Signature-256` before it parses or stores the body.
5. Subscribe only to the Instagram fields your app has approval for. This route persists only events that contain lead-like payload data or campaign/form identifiers.

Reference:

- `https://developers.facebook.com/docs/graph-api/webhooks/getting-started`
- `https://developers.facebook.com/docs/instagram-api/guides/webhooks`

## TikTok

1. In the TikTok Developer Portal, open your app and go to the webhook/development configuration section.
2. Add `https://<your-domain>/webhooks/tiktok` as the webhook URL.
3. Store the TikTok client secret in `TIKTOK_APP_SECRET`.
4. The handler validates `TikTok-Signature` using the provider timestamp plus the raw body and rejects requests outside a 5-minute replay window.
5. Use the provider's webhook testing flow to send a sample event and confirm you receive a `200` response.

Reference:

- `https://developers.tiktok.com/doc/overview?enter_method=left_navigation`
- `https://ads.tiktok.com/help/article?aid=10001703`

## Operational notes

- The handlers use `upsert` on `social_leads.id`, so duplicate webhook deliveries do not create duplicate rows.
- Logs intentionally include request IDs, platform names, and row counts, but not secrets or full raw lead payloads.
- When a valid webhook contains no lead-like records, the route still returns `200` so providers do not retry harmless non-lead events forever.
