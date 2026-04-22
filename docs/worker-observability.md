# Worker Observability

## Overview

`nick-site` now has one shared worker-side observability path:

- `src/lib/logger.ts` wraps structured console logging, exposes an optional HTTP log drain, and writes custom Analytics Engine metrics with a fixed column order.
- `functions/_middleware.ts` logs incoming Pages requests plus request outcomes and latency for non-asset, non-`OPTIONS` traffic.
- `functions/ncs/consumer.ts` uses the same logger for queue-processing success, ignored messages, retries, and per-message latency.

This keeps console logs, optional off-platform forwarding, and Cloudflare usage metrics aligned instead of having each Worker route invent its own format.

## Runtime Configuration

### Optional log-drain secrets

Set these as Cloudflare Pages / Worker secrets if you want copies of the structured logs forwarded to an external collector:

- `LOG_LEVEL`
- `LOG_DRAIN_URL`
- `LOG_DRAIN_TOKEN`

`LOG_DRAIN_URL` receives a JSON payload shaped like:

```json
{
  "level": "info",
  "message": "Request completed",
  "service": "nick-site-pages",
  "timestamp": "2026-04-21T12:00:00.000Z",
  "context": {
    "requestId": "4b6f0f08-4ef7-4f7f-a75a-4182a9d341d7",
    "path": "/contact",
    "status": 202,
    "latencyMs": 14.7
  }
}
```

This is intentionally generic. Point it at your own collector, a relay, or another observability service endpoint. If you want a full Sentry SDK integration later, keep the existing logger API and replace the transport implementation in `src/lib/logger.ts`.

### Cloudflare Analytics Engine binding

Both worker configs bind the same dataset:

```toml
[[analytics_engine_datasets]]
binding = "WORKER_ANALYTICS"
dataset = "nick_site_usage_metrics"
```

Files:

- `wrangler.toml`
- `wrangler.ncs-consumer.toml`

Cloudflare creates the dataset automatically after the first deployed write. You do not need to pre-create it manually.

## Metrics Schema

Every metric written by `writeUsageMetric()` uses the same column order:

- `index1`: `<service>:<operation>`
- `blob1`: event type
- `blob2`: service
- `blob3`: operation / route
- `blob4`: action / method
- `blob5`: outcome
- `blob6`: status / reason
- `blob7`: source host / queue name
- `blob8`: location
- `double1`: count, always `1`
- `double2`: latency in milliseconds
- `double3`: error flag, `1` or `0`

Current event types:

- `http_request`
- `queue_message`

Current service names:

- `nick-site-pages`
- `ncs-control-consumer`

## Accessing Logs

### Pages Functions logs

Use either:

- Cloudflare dashboard: `Workers & Pages` -> your Pages project -> deployment logs
- CLI: `wrangler pages deployment tail`

The middleware logs request start, completion, and exceptions with a shared `requestId`, plus latency and response status.

### Queue consumer logs

Use the Worker logs for the consumer deployed from `wrangler.ncs-consumer.toml`. Those logs include:

- queue message id
- request id
- action
- worker id
- queue lag
- processing latency

## Accessing Metrics

You now have two Cloudflare-native places to look:

### 1. Built-in Functions Metrics

For the Pages project, open:

- `Workers & Pages` -> your Pages project -> `Functions Metrics`

This shows Cloudflare's built-in aggregate request/error/invocation graphs for Pages Functions.

### 2. Custom Analytics Engine dataset

The custom request and queue metrics live in the `nick_site_usage_metrics` dataset. Query them through the Analytics Engine SQL API.

Create an API token with:

- `Account` -> `Account Analytics` -> `Read`

Useful smoke test:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "SHOW TABLES"
```

### Example query: top HTTP routes in the last 24 hours

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "
    SELECT
      blob3 AS route,
      SUM(_sample_interval * double1) AS requests,
      SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_latency_ms
    FROM nick_site_usage_metrics
    WHERE blob1 = 'http_request'
      AND timestamp > NOW() - INTERVAL '1' DAY
    GROUP BY route
    ORDER BY requests DESC
    LIMIT 20
  "
```

### Example query: HTTP error outcomes in the last 24 hours

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "
    SELECT
      blob5 AS outcome,
      blob6 AS status,
      SUM(_sample_interval * double1) AS events
    FROM nick_site_usage_metrics
    WHERE blob1 = 'http_request'
      AND timestamp > NOW() - INTERVAL '1' DAY
      AND blob5 != 'success'
    GROUP BY outcome, status
    ORDER BY events DESC
  "
```

### Example query: queue retries and ignores

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "
    SELECT
      blob4 AS action,
      blob5 AS outcome,
      blob6 AS reason,
      SUM(_sample_interval * double1) AS events,
      SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_latency_ms
    FROM nick_site_usage_metrics
    WHERE blob1 = 'queue_message'
      AND timestamp > NOW() - INTERVAL '7' DAY
    GROUP BY action, outcome, reason
    ORDER BY events DESC
  "
```

## Local Development Notes

- `wrangler pages dev` and local queue tests still show structured console logs, so you can validate logger output without deploying.
- Cloudflare does not expose Analytics Engine bindings locally for Pages Functions, so `nick_site_usage_metrics` only receives writes from deployed environments.
