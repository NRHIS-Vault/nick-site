import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { asRecord, extractLeadFields, getString, type SocialLeadRow } from "./social-webhooks/shared";
import type { Lead } from "./leadbot/types";

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
};

type StreamCursor = {
  receivedAt: string;
  id: string;
};

const HEARTBEAT_INTERVAL_MS = 15_000;
const CLIENT_RETRY_MS = 3_000;
const SUBSCRIPTION_READY_TIMEOUT_MS = 15_000;
const RECOVERY_BATCH_SIZE = 50;

const SOURCE_LABELS = {
  meta: "Meta",
  instagram: "Instagram",
  tiktok: "TikTok",
} as const;

const encoder = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Cache-Control, Last-Event-ID, Content-Type",
};

const streamHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...corsHeaders,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const trimToNull = (value: string | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const createSupabaseServerClient = (env: Env): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Server misconfigured: missing Supabase secrets for the lead stream.");
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

const normalizeFieldKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const asDisplayString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => asDisplayString(item))
      .filter((item): item is string => Boolean(item))
      .join(", ");

    return joined || null;
  }

  return null;
};

const findLeadFieldValue = (
  fields: Record<string, unknown> | null,
  candidates: string[]
) => {
  if (!fields) {
    return null;
  }

  const normalizedCandidates = new Set(candidates.map(normalizeFieldKey));

  for (const [key, value] of Object.entries(fields)) {
    if (!normalizedCandidates.has(normalizeFieldKey(key))) {
      continue;
    }

    const normalizedValue = asDisplayString(value);
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return null;
};

const readLeadFields = (leadData: Record<string, unknown>) => {
  const directFields = asRecord(leadData.lead_fields);
  if (directFields) {
    return directFields;
  }

  const rawPayload = asRecord(leadData.raw);
  return rawPayload ? extractLeadFields(rawPayload) : null;
};

const buildLeadName = (fields: Record<string, unknown> | null) => {
  const fullName = findLeadFieldValue(fields, ["full_name", "fullname", "name", "contact_name"]);
  if (fullName) {
    return fullName;
  }

  const firstName = findLeadFieldValue(fields, ["first_name", "firstname", "given_name"]);
  const lastName = findLeadFieldValue(fields, ["last_name", "lastname", "family_name"]);
  const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (combinedName) {
    return combinedName;
  }

  const email = findLeadFieldValue(fields, ["email", "email_address"]);
  if (email) {
    return email.split("@")[0] || "New Lead";
  }

  return "New Lead";
};

const buildLeadTimestamp = (
  leadData: Record<string, unknown>,
  fallbackTimestamp: string
) => {
  const rawTimestamp = getString(leadData, "created_time", "entry_time", "create_time");
  if (!rawTimestamp || Number.isNaN(Date.parse(rawTimestamp))) {
    return fallbackTimestamp;
  }

  return new Date(rawTimestamp).toISOString();
};

const normalizeRealtimeLead = (row: SocialLeadRow): Lead => {
  const leadData = asRecord(row.lead_data) || {};
  const leadFields = readLeadFields(leadData);

  return {
    id: row.id,
    name: buildLeadName(leadFields),
    phone:
      findLeadFieldValue(leadFields, [
        "phone",
        "phone_number",
        "mobile_phone",
        "mobile",
        "cell_phone",
      ]) || "Not provided",
    service:
      findLeadFieldValue(leadFields, [
        "service",
        "service_type",
        "project_type",
        "job_type",
        "fence_type",
        "interest",
        "interested_in",
      ]) || "General Inquiry",
    source: SOURCE_LABELS[row.platform] || row.platform,
    timestamp: buildLeadTimestamp(leadData, row.received_at),
    // These rows are emitted only for fresh inserts into `social_leads`, so the dashboard
    // can safely surface them as new until a later workflow marks them otherwise.
    status: "NEW",
  };
};

const buildStreamCursor = (row: Pick<SocialLeadRow, "id" | "received_at">) =>
  `${new Date(row.received_at).toISOString()}::${row.id}`;

const parseStreamCursor = (value: string | null): StreamCursor | null => {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf("::");
  if (separatorIndex === -1) {
    return null;
  }

  const receivedAt = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 2);

  if (!id || Number.isNaN(Date.parse(receivedAt))) {
    return null;
  }

  return {
    receivedAt: new Date(receivedAt).toISOString(),
    id,
  };
};

const isRowAfterCursor = (row: Pick<SocialLeadRow, "id" | "received_at">, cursor: StreamCursor) => {
  const rowTimestamp = Date.parse(row.received_at);
  const cursorTimestamp = Date.parse(cursor.receivedAt);

  if (rowTimestamp !== cursorTimestamp) {
    return rowTimestamp > cursorTimestamp;
  }

  return row.id > cursor.id;
};

const loadMissedLeadRows = async (supabase: SupabaseClient, cursor: StreamCursor) => {
  // Every emitted lead event carries an SSE `id` in `received_at::row_id` form. Browsers attach
  // that value back as `Last-Event-ID` after reconnects, which lets the worker replay inserts the
  // client missed while the socket was down.
  const { data, error } = await supabase
    .from("social_leads")
    .select("id, platform, campaign_id, lead_data, received_at")
    .gte("received_at", cursor.receivedAt)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(RECOVERY_BATCH_SIZE);

  if (error) {
    throw error;
  }

  return (data || []).filter((row) => isRowAfterCursor(row as SocialLeadRow, cursor)) as SocialLeadRow[];
};

const formatSseMessage = ({
  event,
  data,
  id,
  retry,
}: {
  event?: string;
  data?: unknown;
  id?: string;
  retry?: number;
}) => {
  const lines: string[] = [];

  if (typeof retry === "number") {
    lines.push(`retry: ${retry}`);
  }

  if (id) {
    lines.push(`id: ${id}`);
  }

  if (event) {
    lines.push(`event: ${event}`);
  }

  if (data !== undefined) {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    serialized.split("\n").forEach((line) => {
      lines.push(`data: ${line}`);
    });
  }

  return `${lines.join("\n")}\n\n`;
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  if (!trimToNull(env.SUPABASE_URL) || !trimToNull(env.SUPABASE_KEY)) {
    return jsonResponse(
      {
        ok: false,
        error: "Server misconfigured: missing Supabase secrets for the lead stream.",
      },
      500
    );
  }

  const lastEventId =
    request.headers.get("Last-Event-ID") || request.headers.get("last-event-id");
  const reconnectCursor = parseStreamCursor(lastEventId);
  let closeStream: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const supabase = createSupabaseServerClient(env);
      const deliveredLeadIds = new Set<string>();
      const abortController = new AbortController();
      let channel: RealtimeChannel | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let readyTimer: ReturnType<typeof setTimeout> | null = null;
      let isClosed = false;

      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const stopReadyTimer = () => {
        if (readyTimer) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
      };

      const safeEnqueue = ({
        event,
        data,
        id,
        retry,
      }: {
        event?: string;
        data?: unknown;
        id?: string;
        retry?: number;
      }) => {
        if (isClosed) {
          return;
        }

        try {
          controller.enqueue(
            encoder.encode(
              formatSseMessage({
                event,
                data,
                id,
                retry,
              })
            )
          );
        } catch (error) {
          console.error("Lead stream enqueue failed", error);
          void closeStream?.();
        }
      };

      closeStream = async () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        stopHeartbeat();
        stopReadyTimer();
        abortController.abort();

        if (channel) {
          try {
            await channel.unsubscribe();
          } catch (error) {
            console.warn("Lead stream unsubscribe failed", error);
          }
        }

        try {
          controller.close();
        } catch (_error) {
          // The controller may already be closed if the client disconnected mid-write.
        }
      };

      const emitLeadRow = (row: SocialLeadRow) => {
        if (deliveredLeadIds.has(row.id)) {
          return;
        }

        deliveredLeadIds.add(row.id);
        safeEnqueue({
          event: "lead",
          id: buildStreamCursor(row),
          data: normalizeRealtimeLead(row),
        });
      };

      const failStream = async (message: string, details?: unknown) => {
        if (details) {
          console.error(message, details);
        } else {
          console.error(message);
        }

        safeEnqueue({
          event: "stream-error",
          data: { message },
        });
        await closeStream?.();
      };

      const handleAbort = () => {
        void closeStream?.();
      };

      request.signal.addEventListener("abort", handleAbort, { signal: abortController.signal });

      try {
        channel = supabase
          .channel(`lead-stream:${crypto.randomUUID()}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "social_leads",
            },
            (payload) => {
              emitLeadRow(payload.new as SocialLeadRow);
            }
          );

        readyTimer = setTimeout(() => {
          void failStream(
            `Lead stream did not reach Supabase Realtime ready state within ${SUBSCRIPTION_READY_TIMEOUT_MS}ms.`
          );
        }, SUBSCRIPTION_READY_TIMEOUT_MS);

        channel.subscribe(async (status, error) => {
          if (isClosed) {
            return;
          }

          if (status === "SUBSCRIBED") {
            stopReadyTimer();

            // The webhook handlers already normalize provider payloads into `public.social_leads`,
            // so the dashboard can subscribe directly to Supabase Realtime here instead of adding
            // a second Queue-based fanout path that the current repo does not otherwise use.
            safeEnqueue({
              event: "connected",
              retry: CLIENT_RETRY_MS,
              data: {
                mechanism: "supabase_realtime",
                table: "public.social_leads",
                heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
                resumedFromLastEventId: Boolean(reconnectCursor),
              },
            });

            if (reconnectCursor) {
              try {
                const recoveredRows = await loadMissedLeadRows(supabase, reconnectCursor);
                recoveredRows.forEach((row) => {
                  emitLeadRow(row);
                });
              } catch (recoveryError) {
                await failStream("Lead stream recovery query failed.", recoveryError);
                return;
              }
            }

            heartbeatTimer = setInterval(() => {
              safeEnqueue({
                event: "heartbeat",
                data: {
                  timestamp: new Date().toISOString(),
                },
              });
            }, HEARTBEAT_INTERVAL_MS);

            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            stopReadyTimer();
            await failStream(`Lead stream subscription ended with status ${status}.`, error);
          }
        });
      } catch (error) {
        await failStream("Unable to initialize the lead stream.", error);
      }
    },
    cancel() {
      void closeStream?.();
    },
  });

  return new Response(stream, {
    headers: streamHeaders,
  });
};
