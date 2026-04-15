import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type NcsControlAction = "pause" | "resume";

export type NcsControlQueueMessage = {
  workerId: string;
  action: NcsControlAction;
  requestId: string;
  requestedAt: string;
  source: `ncs/${NcsControlAction}`;
};

export type NcsControlQueueBinding = {
  send(
    body: NcsControlQueueMessage,
    options?: {
      contentType?: "json" | "text" | "bytes" | "v8";
      delaySeconds?: number;
    }
  ): Promise<void>;
};

export type NcsControlProducerEnv = {
  NCS_CONTROL_QUEUE?: NcsControlQueueBinding;
};

export type NcsSupabaseEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
};

type PauseResumeRequest = {
  workerId?: unknown;
};

class NcsHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NcsHttpError";
    this.status = status;
  }
}

const VALID_ACTIONS = new Set<NcsControlAction>(["pause", "resume"]);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const readString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readAction = (value: unknown): NcsControlAction | null => {
  const action = readString(value);
  if (!action || !VALID_ACTIONS.has(action as NcsControlAction)) {
    return null;
  }

  return action as NcsControlAction;
};

const readIsoTimestamp = (value: unknown) => {
  const timestamp = readString(value);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return null;
  }

  return new Date(timestamp).toISOString();
};

export const parseControlQueueMessage = (
  value: unknown
): NcsControlQueueMessage | null => {
  if (!isRecord(value)) {
    return null;
  }

  const workerId = readString(value.workerId);
  const action = readAction(value.action);

  if (!workerId || !action) {
    return null;
  }

  return {
    workerId,
    action,
    requestId: readString(value.requestId) || crypto.randomUUID(),
    requestedAt: readIsoTimestamp(value.requestedAt) || new Date().toISOString(),
    source: (readString(value.source) as `ncs/${NcsControlAction}` | null) || `ncs/${action}`,
  };
};

const readWorkerId = async (request: Request) => {
  const payload = (await request.json().catch(() => null)) as PauseResumeRequest | null;

  if (!isRecord(payload) || typeof payload.workerId !== "string" || !payload.workerId.trim()) {
    throw new NcsHttpError(400, "Request body must include a workerId.");
  }

  return payload.workerId.trim();
};

const getActionLabel = (action: NcsControlAction) =>
  action === "pause" ? "Pause" : "Resume";

const getQueueBinding = (env: NcsControlProducerEnv) => {
  if (!env?.NCS_CONTROL_QUEUE || typeof env.NCS_CONTROL_QUEUE.send !== "function") {
    throw new NcsHttpError(
      500,
      "Server misconfigured: missing NCS_CONTROL_QUEUE queue binding."
    );
  }

  return env.NCS_CONTROL_QUEUE;
};

export const createSupabaseServerClient = (env: NcsSupabaseEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Server misconfigured: missing Supabase secrets for NCS control.");
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

const buildControlQueueMessage = (
  action: NcsControlAction,
  workerId: string
): NcsControlQueueMessage => ({
  workerId,
  action,
  requestId: crypto.randomUUID(),
  requestedAt: new Date().toISOString(),
  source: `ncs/${action}`,
});

export const createNcsControlHandler =
  (action: NcsControlAction) =>
  async ({
    request,
    env,
  }: {
    request: Request;
    env: NcsControlProducerEnv;
  }) => {
    try {
      const workerId = await readWorkerId(request);
      const message = buildControlQueueMessage(action, workerId);

      // The HTTP route should stay fast: validate the request, enqueue a durable control
      // message, return 202, and let the queue consumer perform the state mutation.
      await getQueueBinding(env).send(message, {
        contentType: "json",
      });

      return jsonResponse(
        {
          ok: true,
          action,
          workerId,
          requestId: message.requestId,
          queued: true,
          stub: false,
          message: `${getActionLabel(action)} request queued for ${workerId}. The NCS control consumer will update worker state shortly.`,
        },
        202
      );
    } catch (error) {
      const status = error instanceof NcsHttpError ? error.status : 500;
      return jsonResponse(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : `Unable to queue the ${action} request.`,
        },
        status
      );
    }
  };

export const onNcsControlOptionsRequest = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
