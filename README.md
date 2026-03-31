\# nick-site (Landing)

Public marketing/landing page for the Nick AI platform.

## Stack
- Vite + React 18 + TypeScript
- Tailwind CSS + shadcn/ui (tooltip, toaster/sonner)
- lucide-react icons

## Prerequisites
- Node.js **18**+
- npm

## Quick start
```bash
cd nick-site
npm install
npm run dev
```
Visit the URL Vite prints (default http://localhost:5173).

## Build & preview
```bash
npm run build   # outputs dist/
npm run preview # serves the production build locally
``` 

## Lint
```bash
npm run lint
```

## Testing
```bash
npm test
```
- `functions/chat.test.ts` mocks the LLM provider stream plus internal tool/API fetches and verifies normalized SSE forwarding, tool-result injection, invalid input handling, unsupported tool rejection, and the new safety guardrails.

## Environment setup
- Copy the sample env file: `cp .env.example .env`
- Required keys (all `VITE_` so Vite exposes them to the client bundle):
  - `VITE_SUPABASE_URL` – Supabase project URL for auth/data.
  - `VITE_SUPABASE_ANON_KEY` – Supabase anon/public key for the client SDK.
  - `VITE_STRIPE_PK` – Stripe publishable key for checkout/payment flows.
  - `VITE_API_BASE` – Base URL for your backend/worker API.
- Server-only chat keys do **not** belong in `.env` or any `VITE_` variable. Keep them in Cloudflare Pages secrets for deployed environments, or copy `.dev.vars.example` to `.dev.vars` when running local Pages Functions:
  - `OPENAI_API_KEY` – enables the OpenAI-backed chat path.
  - `OPENAI_MODEL` – optional override; defaults to `gpt-4.1-mini`.
  - `ANTHROPIC_API_KEY` – enables the Anthropic-backed chat path.
  - `ANTHROPIC_MODEL` – optional override; defaults to `claude-sonnet-4-20250514`.
  - If both provider keys are set, `/chat` uses OpenAI first so selection stays deterministic.
- LeadBot platform credentials are also server-only and belong in Cloudflare Pages secrets or `.dev.vars`, not the client bundle:
  - Meta: `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`
  - Instagram: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_PAGE_ID`
  - TikTok: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_PAGE_ID`, optional `TIKTOK_LEAD_LOOKBACK_DAYS`
- `vite.config.ts` loads `dotenv` plus `loadEnv`; runtime code reads from `import.meta.env` via `src/lib/config.ts`. Empty strings are allowed when a service is not configured.

## Project structure
- `src/App.tsx` – wraps routing, theme, query, tooltips, and toasters.
- `src/pages/Index.tsx` – entry page that renders the layout.
- `src/components/` – Navigation, Hero, Features, About, Contact, Footer.
- `src/contexts/AppContext.tsx` – sidebar toggle state (currently used by mobile nav patterns).
- `src/contexts/ThemeContext.tsx` – light/dark state + toggler with localStorage persistence.
- `src/lib/utils.ts` – `cn` className helper.
- `src/lib/config.ts` – typed access to env vars with safe fallbacks.
- `src/index.css` – Tailwind tokens and base styles.

## Theming
- Light/dark tokens live in `src/index.css` and drive Tailwind classes like `bg-background`, `text-foreground`, `bg-card`, `bg-primary`, and the custom `brand`/`surface` colors.
- `src/contexts/ThemeContext.tsx` sets the root `classList` (`light`/`dark`) and mirrors the preference to `localStorage`.
- The app is wrapped by `ThemeProvider` inside `src/components/AppLayout.tsx`; the Navigation bar includes a toggle (desktop + mobile) that flips themes instantly.
- To extend the palette, add new CSS variables in `index.css` and expose them in `tailwind.config.ts` under `theme.extend.colors`; prefer referencing tokens in components instead of hard-coded hex values.

## Serverless API (Cloudflare Pages Functions)
- Functions live in `functions/contact.ts` and `functions/newsletter.ts`. Both accept POST JSON payloads and respond with `{ ok: boolean, message?: string, error?: string }`; CORS headers and OPTIONS preflight are handled for you.
- Leave `VITE_API_BASE` empty to call the functions on the same domain. If you develop locally without `wrangler pages dev`, point `VITE_API_BASE` at your Cloudflare Pages preview/production URL so `fetch` calls hit the live functions.
- Persistence uses Supabase. Create the tables via the Supabase SQL editor (copy/paste both statements):
  ```sql
  create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null,
    email text not null,
    message text not null
  );
  create table if not exists public.newsletter_subscribers (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    created_at timestamptz not null default now(),
    source text default 'website'
  );
  create unique index if not exists newsletter_email_idx on public.newsletter_subscribers (lower(email));
  ```
  Columns: `messages` stores `name`, `email`, `message`, and a timestamp; `newsletter_subscribers` stores `email`, optional `source`, and a timestamp with a case-insensitive unique constraint on email.
- Configure worker secrets (not Vite env): `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY` (use the service role key so inserts succeed). The functions read these via the `env` object when constructing the Supabase client.
- Additional sample API routes (GET, JSON, CORS-enabled) for the dashboard: `/businessStats`, `/leadManagement`, `/workers`, `/businessCards`, `/leadBot`, `/tradingBot`, `/customerPortal`, `/rhnisIdentity`. Each returns mock data shaped like the dashboard panels (stats, leads, worker status, cards, LeadBot campaigns/leads, TradingBot balances/signals/trades, customer services/subscribers, RHNIS identity + beacon data).
- `/leadBot` now supports live platform modules in `functions/leadbot/meta.ts`, `functions/leadbot/instagram.ts`, and `functions/leadbot/tiktok.ts`. When the required server secrets are configured, the function fetches recent campaigns and leads from those APIs, normalizes them into the dashboard response shape, and paginates provider responses server-side. When no platform credentials are configured, it falls back to the existing demo payload so the UI still has local sample data.
- LeadBot credential setup:
  - Meta / Facebook Lead Ads: create a Meta developer app, add Marketing API access, and generate a long-lived access token for the Page/ad account you want to read. Capture the app ID/secret, ad account ID, and Page ID. Start with the official docs: `https://developers.facebook.com/docs/marketing-api/get-started/` and Lead Ads retrieval: `https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/`
  - Meta scopes commonly required for this worker: `ads_read`, `pages_read_engagement`, `pages_manage_ads`, and `leads_retrieval`. Meta also recommends `appsecret_proof` for server-side calls; the worker computes it automatically when `META_APP_SECRET` is set.
  - Instagram Graph: connect an Instagram Professional account to a Facebook Page, create a Meta app with Instagram Graph access, and capture the Instagram business account ID plus the connected Page ID used for lead forms. Official docs: `https://developers.facebook.com/docs/instagram-api/getting-started`
  - Instagram scopes commonly required here: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, and `leads_retrieval` when reading lead forms from the connected Page.
  - TikTok For Business: create a TikTok developer app, request Marketing API access for the advertiser account, and store the app ID/secret, advertiser access token, advertiser ID, and lead page ID. Official references: `https://ads.tiktok.com/help/article/marketing-api?lang=en`, `https://ads.tiktok.com/help/article/access-leads-data?lang=en`, and the official SDK repo `https://github.com/tiktok/tiktok-business-api-sdk`
  - TikTok lead downloads are retained for a limited window in Leads Center, so the worker limits the export lookback window and polls the lead-export task a small number of times before failing fast.
- LeadBot rate limiting:
  - Meta/Instagram Graph API usage is constrained by app/user/page usage windows rather than a single fixed request count. The worker keeps page sizes small, follows `paging.next` cursors, and avoids unbounded loops.
  - TikTok Marketing API can return `429` on list/report/export endpoints. The worker paginates in 25-item chunks, caps page depth, and short-polls the lead export task instead of polling indefinitely.
- `/chat` now accepts `POST` JSON shaped like `{ messages: [...], tools: [...], conversationId?: string }` and returns a normalized server-sent event stream. When a valid Supabase bearer token is present, the worker creates/updates the conversation row and persists the user + assistant messages to Supabase.
  - `meta` – selected provider, model, and tool list.
  - `token` – incremental assistant text.
  - `tool_call` – the tool name and parsed arguments requested by the model.
  - `tool_result` – the internal API result returned to the model.
  - `error` – surfaced provider or tool failure.
  - `done` – terminal success marker.
- `/chat-history` returns the authenticated user's past conversations and their stored messages. The frontend uses this to hydrate the latest conversation on mount.
- The tool registry now lives in `functions/chat/tools.ts`. It is the single source of truth for tool metadata, aliases, and execution handlers.
- Supported canonical tool names are `searchLeads` and `fetchTrades`. Legacy aliases `get_leads` and `get_trades` are still accepted, but the worker normalizes them to the canonical registry entries before exposing them to the model.
- `searchLeads` is mapped to `/leadManagement`, and `fetchTrades` is mapped to `/tradingBot`. The worker only executes tools that exist in that registry; unknown tool names are rejected as unauthorized instead of being invoked dynamically.
- Chat persistence schema:
  - `public.conversations` stores one row per chat session (`id`, `user_id`, `title`, `created_at`, `updated_at`).
  - `public.chat_messages` stores the persisted user/assistant transcript (`id`, `conversation_id`, `user_id`, `role`, `content`, `created_at`).
  - Apply `nick-frontend/supabase/migrations/20260326_chat_persistence.sql` to create the tables, indexes, and RLS policies. `nick-frontend/supabase/migrations/20260320_full_platform_schema.sql` now includes the same chat tables in the full bootstrap schema.
- Local dev:
  - Use `wrangler pages dev` if you want to exercise the serverless functions locally with `.dev.vars`.
  - If you only run `vite`, leave the frontend pointed at a deployed Pages URL via `VITE_API_BASE`, because Vite alone does not execute the `functions/` directory.
- Safety guidance:
  - Keep `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` server-side only. Never copy them into any `VITE_` variable or client bundle.
  - Chat persistence requires the same `SUPABASE_URL` and `SUPABASE_KEY` worker secrets already used by the contact/newsletter functions.
  - `/chat-history` requires an `Authorization: Bearer <supabase-access-token>` header. `/chat` will persist only when that header is present and valid.
  - `/chat` only executes a small allowlist of read-only internal tools. It does not proxy arbitrary URLs or import/execute arbitrary function names from the model.
  - Each non-assistant message is limited to 4,000 characters before it ever reaches the provider.
  - A lightweight blocked-phrase list currently rejects obvious prompt-injection and harmful requests such as `ignore previous instructions`, `reveal your system prompt`, `show your hidden instructions`, `make a bomb`, and `build a bomb`. Treat this as a simple first-pass guard, not a full moderation system.
  - Prompts and tool results are sent to the selected provider, so avoid forwarding highly sensitive customer data unless that is acceptable for your deployment and policy posture.
  - CORS is currently `*` to match the other sample routes; tighten it before exposing the endpoint outside your own frontend.
- Keep the shared `corsHeaders`/`jsonResponse` pattern so the React mutations continue to work without changes.

## Deployment
- Static build; suitable for Cloudflare Pages or any static host. Build command: `npm run build`; publish `dist/`.
- If you add API calls later, configure env vars via Vite `import.meta.env` and ensure they are prefixed with `VITE_`.
