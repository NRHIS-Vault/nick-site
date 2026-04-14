import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type NcsEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  NCS_STATUS_ENDPOINT?: string;
  NCS_STATUS_BEARER_TOKEN?: string;
};

type NcsStatusSource = "supabase" | "service" | "stub";
type NcsWorkerStatus = "idle" | "busy" | "error";
type RecordValue = Record<string, unknown>;

type NormalizedWorkerStatus = {
  id: string;
  workerKey: string;
  name: string;
  status: NcsWorkerStatus;
  rawStatus: string | null;
  statusMessage: string | null;
  isPaused: boolean;
  source: NcsStatusSource;
  job: {
    id: string | null;
    name: string | null;
    type: string | null;
    queue: string | null;
    progressPct: number | null;
    details: RecordValue | null;
    error: string | null;
  };
  timestamps: {
    createdAt: string | null;
    updatedAt: string | null;
    pausedAt: string | null;
    lastHeartbeatAt: string | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
  };
};

const STATUS_PRIORITY: Record<NcsWorkerStatus, number> = {
  error: 0,
  busy: 1,
  idle: 2,
};

const BUSY_STATUSES = new Set([
  "busy",
  "running",
  "processing",
  "working",
  "queued",
  "starting",
  "retrying",
]);

const ERROR_STATUSES = new Set([
  "error",
  "failed",
  "offline",
  "degraded",
  "stalled",
  "timed_out",
  "timeout",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asRecord = (value: unknown): RecordValue | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : null;

const readString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const readBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return null;
};

const readTimestamp = (value: unknown) => {
  const timestamp = readString(value);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return null;
  }

  return new Date(timestamp).toISOString();
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createSupabaseServerClient = (env: NcsEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Server misconfigured: missing Supabase secrets for NCS status.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (input, init) => fetch(input, init),
    },
  });
};

const normalizeDetails = (value: unknown) => {
  const details = asRecord(value);
  if (details) {
    return details;
  }

  const text = readString(value);
  return text ? { summary: text } : null;
};

const resolveCurrentJobRecord = (row: RecordValue) =>
  asRecord(row.current_job) ||
  asRecord(row.currentJob) ||
  asRecord(row.job) ||
  asRecord(row.active_job) ||
  asRecord(row.activeJob);

const resolveStatus = (rawStatus: string | null, errorMessage: string | null): NcsWorkerStatus => {
  const normalizedStatus = rawStatus?.toLowerCase() || null;

  if (errorMessage || (normalizedStatus && ERROR_STATUSES.has(normalizedStatus))) {
    return "error";
  }

  if (normalizedStatus && BUSY_STATUSES.has(normalizedStatus)) {
    return "busy";
  }

  return "idle";
};

const normalizeWorkerRow = (
  row: RecordValue,
  source: NcsStatusSource
): NormalizedWorkerStatus => {
  const currentJob = resolveCurrentJobRecord(row);
  const errorMessage =
    readString(currentJob?.error) ||
    readString(currentJob?.error_message) ||
    readString(row.error) ||
    readString(row.error_message) ||
    readString(row.last_error);
  const rawStatus =
    readString(row.status) ||
    readString(row.runner_status) ||
    readString(row.state) ||
    readString(currentJob?.status);
  const name =
    readString(row.name) ||
    readString(row.display_name) ||
    readString(row.worker_name) ||
    readString(row.worker_key) ||
    "Unnamed worker";
  const workerKey =
    readString(row.worker_key) ||
    readString(row.workerKey) ||
    readString(row.slug) ||
    slugify(name) ||
    "worker";
  const id =
    readString(row.id) ||
    readString(row.worker_id) ||
    readString(row.workerId) ||
    workerKey ||
    crypto.randomUUID();
  const pausedAt = readTimestamp(row.paused_at) || readTimestamp(row.pausedAt);
  const isPaused =
    readBoolean(row.is_paused) ??
    readBoolean(row.isPaused) ??
    Boolean(pausedAt);

  return {
    id,
    workerKey,
    name,
    status: resolveStatus(rawStatus, errorMessage),
    rawStatus: rawStatus?.toLowerCase() || null,
    statusMessage:
      errorMessage ||
      readString(row.status_message) ||
      readString(row.statusMessage) ||
      (isPaused ? "Worker is paused." : null),
    isPaused,
    source,
    job: {
      id:
        readString(currentJob?.id) ||
        readString(currentJob?.job_id) ||
        readString(row.job_id) ||
        readString(row.current_job_id),
      name:
        readString(currentJob?.name) ||
        readString(currentJob?.job_name) ||
        readString(row.job_name) ||
        readString(row.current_job_name),
      type:
        readString(currentJob?.type) ||
        readString(currentJob?.job_type) ||
        readString(row.job_type),
      queue:
        readString(currentJob?.queue) ||
        readString(currentJob?.queue_name) ||
        readString(row.queue_name),
      progressPct:
        readNumber(currentJob?.progressPct) ??
        readNumber(currentJob?.progress_pct) ??
        readNumber(row.progress_pct) ??
        readNumber(row.progress),
      details:
        normalizeDetails(currentJob?.details) ||
        normalizeDetails(currentJob?.metadata) ||
        normalizeDetails(row.job_details) ||
        normalizeDetails(row.details) ||
        normalizeDetails(row.metadata),
      error: errorMessage,
    },
    timestamps: {
      createdAt: readTimestamp(row.created_at) || readTimestamp(row.createdAt),
      updatedAt: readTimestamp(row.updated_at) || readTimestamp(row.updatedAt),
      pausedAt,
      lastHeartbeatAt:
        readTimestamp(row.last_heartbeat_at) || readTimestamp(row.lastHeartbeatAt),
      lastStartedAt: readTimestamp(row.last_started_at) || readTimestamp(row.lastStartedAt),
      lastFinishedAt:
        readTimestamp(row.last_finished_at) || readTimestamp(row.lastFinishedAt),
    },
  };
};

const sortWorkers = (workers: NormalizedWorkerStatus[]) =>
  [...workers].sort((left, right) => {
    const statusDelta = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return left.name.localeCompare(right.name);
  });

const summarizeWorkers = (workers: NormalizedWorkerStatus[]) => ({
  totalWorkers: workers.length,
  idleWorkers: workers.filter((worker) => worker.status === "idle").length,
  busyWorkers: workers.filter((worker) => worker.status === "busy").length,
  errorWorkers: workers.filter((worker) => worker.status === "error").length,
  pausedWorkers: workers.filter((worker) => worker.isPaused).length,
});

const readWorkerArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => asRecord(item)).filter((item): item is RecordValue => Boolean(item));
};

const loadWorkersFromSupabase = async (env: NcsEnv) => {
  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase.from("ncs_workers").select("*");

  if (error) {
    throw new Error(`Failed to query ncs_workers: ${error.message}`);
  }

  return readWorkerArray(data);
};

const loadWorkersFromService = async (env: NcsEnv) => {
  const endpoint = trimToNull(env.NCS_STATUS_ENDPOINT);
  if (!endpoint) {
    return null;
  }

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      ...(trimToNull(env.NCS_STATUS_BEARER_TOKEN)
        ? { Authorization: `Bearer ${trimToNull(env.NCS_STATUS_BEARER_TOKEN)}` }
        : {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `NCS status service returned ${response.status} ${response.statusText}.`
    );
  }

  const payload = await response.json();

  if (Array.isArray(payload)) {
    return readWorkerArray(payload);
  }

  const payloadRecord = asRecord(payload);
  if (!payloadRecord || !Array.isArray(payloadRecord.workers)) {
    throw new Error("NCS status service must return an array or an object with a workers array.");
  }

  return readWorkerArray(payloadRecord.workers);
};

const buildStubWorkers = (): NormalizedWorkerStatus[] => {
  const generatedAt = new Date().toISOString();

  return [
    {
      id: "stub-ncs-coordinator",
      workerKey: "ncs-coordinator",
      name: "NCS Coordinator",
      status: "busy",
      rawStatus: "running",
      statusMessage: "Using fallback data because no NCS provider is configured.",
      isPaused: false,
      source: "stub",
      job: {
        id: "job-bootstrap-sync",
        name: "Bootstrap sync",
        type: "scheduler",
        queue: "default",
        progressPct: 42,
        details: {
          note: "Configure SUPABASE_URL/SUPABASE_KEY for public.ncs_workers or NCS_STATUS_ENDPOINT for an external provider.",
        },
        error: null,
      },
      timestamps: {
        createdAt: generatedAt,
        updatedAt: generatedAt,
        pausedAt: null,
        lastHeartbeatAt: generatedAt,
        lastStartedAt: generatedAt,
        lastFinishedAt: null,
      },
    },
    {
      id: "stub-email-runner",
      workerKey: "email-runner",
      name: "Email Runner",
      status: "idle",
      rawStatus: "idle",
      statusMessage: "Waiting for the next scheduled job.",
      isPaused: false,
      source: "stub",
      job: {
        id: null,
        name: null,
        type: null,
        queue: "email",
        progressPct: null,
        details: null,
        error: null,
      },
      timestamps: {
        createdAt: generatedAt,
        updatedAt: generatedAt,
        pausedAt: null,
        lastHeartbeatAt: generatedAt,
        lastStartedAt: null,
        lastFinishedAt: generatedAt,
      },
    },
  ];
};

const loadNormalizedWorkers = async (
  env: NcsEnv
): Promise<{ source: NcsStatusSource; workers: NormalizedWorkerStatus[] }> => {
  if (trimToNull(env.NCS_STATUS_ENDPOINT)) {
    const serviceWorkers = await loadWorkersFromService(env);
    return {
      source: "service",
      workers: sortWorkers(serviceWorkers.map((worker) => normalizeWorkerRow(worker, "service"))),
    };
  }

  if (trimToNull(env.SUPABASE_URL) && trimToNull(env.SUPABASE_KEY)) {
    const supabaseWorkers = await loadWorkersFromSupabase(env);
    return {
      source: "supabase",
      workers: sortWorkers(
        supabaseWorkers.map((worker) => normalizeWorkerRow(worker, "supabase"))
      ),
    };
  }

  return {
    source: "stub",
    workers: buildStubWorkers(),
  };
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async ({ env }: { env: NcsEnv }) => {
  try {
    // The status route is intentionally the normalization boundary for NCS. Frontend
    // code should not know whether the data came from Supabase rows, another service,
    // or the local fallback contract.
    const { source, workers } = await loadNormalizedWorkers(env);

    return jsonResponse({
      generatedAt: new Date().toISOString(),
      source,
      summary: summarizeWorkers(workers),
      workers,
    });
  } catch (error) {
    console.error("Failed to load NCS status", error);
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load NCS status right now.",
      },
      500
    );
  }
};
