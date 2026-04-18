# Identity Service Integration

`functions/identity.ts` is the authenticated RHNIS read model for the dashboard.

## Endpoint
- Primary route: `GET /identity`
- Legacy alias: `GET /rhnisIdentity`
- Required header: `Authorization: Bearer <supabase-access-token>`

## Data flow
1. The worker validates the Supabase access token with `supabase.auth.getUser(token)`.
2. It loads the signed-in user's row from `public.rhnis_profiles` using `profile_id = auth.users.id`.
3. It loads related rows from:
   - `public.rhnis_identity_features`
   - `public.rhnis_beacon_data`
4. It normalizes `legacy_stats` from `public.rhnis_profiles` into the `legacy` tab payload.

## Response shape
- `identity`: feature rows plus summary counts for the Identity tab.
- `beacon`: beacon signature, propagation metrics, and aggregate counts for the Beacon tab.
- `legacy`: normalized storage metrics, derived detail cards, and optional notes for the Legacy tab.

## Required worker secrets
- `SUPABASE_URL`
- `SUPABASE_KEY`

Use the service role key for `SUPABASE_KEY`, because the worker validates bearer tokens and reads RHNIS rows server-side.

## Frontend integration
- `nick-frontend/src/lib/api.ts` sends the current Supabase access token to `/identity`.
- `nick-frontend/src/components/RHNISIdentity.tsx` uses `useQuery` with the authenticated endpoint and renders loading, error, auth-required, empty, and populated states from the returned tab payload.
- `nick-frontend/src/components/RHNISIdentity.test.tsx` mocks the authenticated worker response, verifies the bearer token header, and checks the Identity, Beacon, and Legacy tabs against one sample profile payload.

## Local testing
- Local dev fallback auth in the frontend is not sufficient for this route. Use a real Supabase session token.
- If a user has no `public.rhnis_profiles` row, the worker returns `200 OK` with `hasProfile: false` and empty tab payloads so the UI can show a deterministic empty state.
