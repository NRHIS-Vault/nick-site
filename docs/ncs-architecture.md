# NCS Architecture

## Overview

The Nick Control System (NCS) dashboard is split into three layers:

1. `nick-frontend/src/components/WorkerControl.tsx` renders the operator view.
2. `nick-site/functions/ncs/status.ts` is the read model for worker health.
3. `nick-site/functions/ncs/pause.ts` and `nick-site/functions/ncs/resume.ts` are queue producers for control requests.
4. `nick-site/functions/ncs/consumer.ts` is the shared queue consumer implementation used by `nick-site/workers/ncs-control-consumer.ts`.

`WorkerControl` uses React Query to poll `GET /ncs/status` every 30 seconds. That worker normalizes raw runner records into a stable frontend contract, so the UI does not need to know whether the source is Supabase or another service.

## Status Flow

`GET /ncs/status` resolves data in this order:

1. If `NCS_STATUS_ENDPOINT` is configured, fetch worker state from that external service.
2. Otherwise, if `SUPABASE_URL` and `SUPABASE_KEY` are configured, read rows from `public.ncs_workers`.
3. Otherwise, return a small stub payload so the dashboard can render in local dev.

The response shape is:

```json
{
  "generatedAt": "2026-04-13T10:05:00.000Z",
  "source": "supabase",
  "summary": {
    "totalWorkers": 2,
    "idleWorkers": 1,
    "busyWorkers": 1,
    "errorWorkers": 0,
    "pausedWorkers": 0
  },
  "workers": [
    {
      "id": "worker-1",
      "workerKey": "leadbot-runner",
      "name": "LeadBot Runner",
      "status": "busy",
      "rawStatus": "running",
      "statusMessage": "Polling provider queues.",
      "isPaused": false,
      "source": "supabase",
      "job": {
        "id": "job-1",
        "name": "Lead intake sync",
        "type": "sync",
        "queue": "leadbot",
        "progressPct": 65,
        "details": {
          "summary": "Syncing Meta and TikTok leads."
        },
        "error": null
      },
      "timestamps": {
        "createdAt": "2026-04-13T09:00:00.000Z",
        "updatedAt": "2026-04-13T10:05:00.000Z",
        "pausedAt": null,
        "lastHeartbeatAt": "2026-04-13T10:05:00.000Z",
        "lastStartedAt": "2026-04-13T09:58:00.000Z",
        "lastFinishedAt": null
      }
    }
  ]
}
```

## Supabase Contract

The current worker reads `public.ncs_workers` with `select("*")` and normalizes optional fields. These columns are the expected core contract:

- Worker identity: `id`, `worker_key`, `name`
- Status fields: `status`, `status_message`, `is_paused`, `paused_at`, `error_message`
- Job fields: `job_id`, `job_name`, `job_type`, `queue_name`, `progress_pct`
- Timestamps: `created_at`, `updated_at`, `last_heartbeat_at`, `last_started_at`, `last_finished_at`
- Optional nested job object: `current_job jsonb`

`current_job` can carry the richer live payload:

```json
{
  "id": "job-1",
  "name": "Lead intake sync",
  "type": "sync",
  "queue": "leadbot",
  "progress_pct": 65,
  "details": {
    "summary": "Syncing Meta and TikTok leads."
  },
  "error": null
}
```

The worker maps raw runner states into the UI-safe status enum:

- `busy`: `busy`, `running`, `processing`, `working`, `queued`, `starting`, `retrying`
- `error`: `error`, `failed`, `offline`, `degraded`, `stalled`, `timeout`
- `idle`: everything else

## Control Flow

`POST /ncs/pause` and `POST /ncs/resume` currently accept:

```json
{
  "workerId": "worker-1"
}
```

They return `202 Accepted` after publishing a control message to `NCS_CONTROL_QUEUE`.

The queue message includes:

```json
{
  "workerId": "worker-1",
  "action": "pause",
  "requestId": "de305d54-75b4-431b-adb2-eb6b9e546014",
  "requestedAt": "2026-04-14T12:00:00.000Z",
  "source": "ncs/pause"
}
```

The consumer then:

1. Validates each batch message.
2. Updates `public.ncs_workers` by `id`, with a fallback lookup by `worker_key`.
3. Marks the row paused or resumed.
4. Logs the processed control event.
5. Acknowledges success or retries transient failures.

Detailed enqueue/consume documentation lives in `docs/ncs-control-queue.md`.

## Frontend Notes

- `WorkerControl.tsx` renders a table instead of mock cards so operators can compare worker status, job context, and timestamps side by side.
- The panel uses `useQuery(["ncs", "status"])` for reads and `useMutation()` for pause/resume actions.
- Successful control actions invalidate the status query so the screen refreshes after the queue-backed state update lands.
- `nick-frontend/src/components/WorkerControl.test.tsx` covers that queue-backed flow end to end from the browser side by mocking the three NCS HTTP routes and draining `nick-frontend/src/test/ncsQueue.ts` before asserting the refreshed UI state.
