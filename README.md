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

## Environment setup
- Copy the sample env file: `cp .env.example .env`
- Required keys (all `VITE_` so Vite exposes them to the client bundle):
  - `VITE_SUPABASE_URL` – Supabase project URL for auth/data.
  - `VITE_SUPABASE_ANON_KEY` – Supabase anon/public key for the client SDK.
  - `VITE_STRIPE_PK` – Stripe publishable key for checkout/payment flows.
  - `VITE_API_BASE` – Base URL for your backend/worker API.
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
- Keep the shared `corsHeaders`/`jsonResponse` pattern so the React mutations continue to work without changes.

## Deployment
- Static build; suitable for Cloudflare Pages or any static host. Build command: `npm run build`; publish `dist/`.
- If you add API calls later, configure env vars via Vite `import.meta.env` and ensure they are prefixed with `VITE_`.
