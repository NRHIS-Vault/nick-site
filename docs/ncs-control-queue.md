# NCS Control Queue

## Overview

The NCS control path is now asynchronous:

1. The dashboard calls `POST /ncs/pause` or `POST /ncs/resume`.
2. The Pages Function validates the request and publishes a JSON control message to `NCS_CONTROL_QUEUE`.
3. A dedicated queue consumer Worker receives the message batch.
4. The consumer updates `public.ncs_workers` in Supabase and logs the processed event.

This keeps the operator-facing HTTP request fast and moves the state mutation into a retryable background worker.

## Queue Binding

`wrangler.toml` is the Pages project config. It declares the producer binding:

```toml
[[queues.producers]]
binding = "NCS_CONTROL_QUEUE"
queue = "ncs-control-queue"
```

- `binding` is the JavaScript name exposed to Pages Functions as `env.NCS_CONTROL_QUEUE`.
- `queue` is the Cloudflare Queue resource name in your account.

The consumer uses a separate config file, `wrangler.ncs-consumer.toml`:

```toml
main = "./workers/ncs-control-consumer.ts"

[[queues.consumers]]
queue = "ncs-control-queue"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
retry_delay = 30
```

The split is intentional. Cloudflare documents queue producers in Wrangler configuration for Pages/Workers, while queue consumers are configured on a Worker `queue()` handler. In this repo, the Pages project publishes messages and the separate Worker consumes them.

## Message Shape

Each control request becomes one queue message:

```json
{
  "workerId": "worker-1",
  "action": "pause",
  "requestId": "de305d54-75b4-431b-adb2-eb6b9e546014",
  "requestedAt": "2026-04-14T12:00:00.000Z",
  "source": "ncs/pause"
}
```

- `workerId` is the worker identifier coming from the dashboard.
- `action` is either `pause` or `resume`.
- `requestId` is generated at enqueue time and returned to the client for traceability.
- `requestedAt` records when the HTTP route published the message.
- `source` tells the consumer which route produced the message.

## Enqueue Flow

1. `functions/ncs/pause.ts` and `functions/ncs/resume.ts` call the shared handler in `functions/ncs/shared.ts`.
2. The handler reads `{ workerId }` from the JSON body.
3. The handler builds an `NcsControlQueueMessage`.
4. The handler calls `await env.NCS_CONTROL_QUEUE.send(message, { contentType: "json" })`.
5. The route returns `202 Accepted` with:
   - `action`
   - `workerId`
   - `requestId`
   - `queued: true`
   - a human-readable message for the UI toast

The HTTP response does not wait for Supabase writes. That work is deferred to the queue consumer.

## Consumer Flow

`workers/ncs-control-consumer.ts` re-exports the actual queue handler from `functions/ncs/consumer.ts`.

For each queue message in a batch, the consumer:

1. Validates the message shape.
2. Lazily creates a server-side Supabase client using `SUPABASE_URL` and `SUPABASE_KEY`.
3. Updates `public.ncs_workers` by `id`. If no row matches, it retries the lookup by `worker_key`.
4. Writes the control state:
   - `pause` sets `status = 'paused'`, `is_paused = true`, `paused_at = <processed timestamp>`, and updates `status_message` / `updated_at`.
   - `resume` sets `status = 'idle'`, `is_paused = false`, clears `paused_at`, and updates `status_message` / `updated_at`.
5. Logs the processed event with the queue message id, request id, worker id, action, and updated worker fields.
6. Acknowledges the message on success.

## Acknowledgement And Retry Rules

- Malformed messages are logged and acknowledged immediately. Retrying bad payloads would only poison the queue.
- Messages targeting an unknown worker are logged and acknowledged. They are treated as operator/data issues, not transient infrastructure failures.
- Transient failures, such as a Supabase update error, call `message.retry({ delaySeconds: 30 })`.

This per-message `ack()` / `retry()` pattern matters because Cloudflare Queues delivers batches. Explicit acknowledgement prevents one failing message from replaying earlier successful updates in the same batch.

## Deployment Notes

1. Create the queue resource:

```bash
npx wrangler queues create ncs-control-queue
```

2. Deploy the Pages project with `wrangler.toml` so `NCS_CONTROL_QUEUE` is available to `/ncs/pause` and `/ncs/resume`.
3. Deploy the consumer Worker with:

```bash
npx wrangler publish -c wrangler.ncs-consumer.toml
```

4. Set `SUPABASE_URL` and `SUPABASE_KEY` on the consumer Worker as secrets. The consumer needs the same server-side Supabase credentials as the status worker.
5. In CI, the GitHub Actions deploy job now syncs the consumer secrets with `wrangler secret put` before running the publish command.

## Local Testing

- Use `wrangler pages dev` for the Pages side if you want to exercise `/ncs/pause` and `/ncs/resume` locally.
- Run the consumer Worker separately with the consumer Wrangler config if you need end-to-end queue testing.
- For unit tests in this repo, `functions/ncs/pause.test.ts`, `functions/ncs/resume.test.ts`, and `functions/ncs/consumer.test.ts` mock the queue binding and Supabase client so the enqueue/consume logic can be verified without talking to Cloudflare.
