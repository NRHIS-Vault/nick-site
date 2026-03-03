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

## Project structure
- `src/App.tsx` – wraps routing, theme, query, tooltips, and toasters.
- `src/pages/Index.tsx` – entry page that renders the layout.
- `src/components/` – Navigation, Hero, Features, About, Contact, Footer, ThemeProvider.
- `src/contexts/AppContext.tsx` – sidebar toggle state (currently used by mobile nav patterns).
- `src/lib/utils.ts` – `cn` className helper.
- `src/index.css` – Tailwind tokens and base styles.

## Deployment
- Static build; suitable for Cloudflare Pages or any static host. Build command: `npm run build`; publish `dist/`.
- If you add API calls later, configure env vars via Vite `import.meta.env` and ensure they are prefixed with `VITE_`.
