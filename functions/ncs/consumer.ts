import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  parseControlQueueMessage,
  type NcsControlAction,
  type NcsControlQueueMessage,
  type NcsSupabaseEnv,
} from "./shared";

type QueueRetryOptions = {
  delaySeconds?: number;
};

type QueueMessageLike<TBody> = {
  id: string;
  body: TBody;
  attempts?: number;
  ack(): void;
  retry(options?: QueueRetryOptions): void;
};

type QueueBatchLike<TBody> = {
  messages: QueueMessageLike<TBody>[];
};

type UpdatedWorkerRow = {
  id: string;
  worker_key?: string | null;
  name?: string | null;
  status?: string | null;
  is_paused?: boolean | null;
  paused_at?: string | null;
  updated_at?: string | null;
};

const CONTROL_RETRY_DELAY_SECONDS = 30;

const buildWorkerPatch = (action: NcsControlAction, processedAt: string) => {
  if (action === "pause") {
    return {
      status: "paused",
      status_message: "Pause requested via NCS control queue.",
      is_paused: true,
      paused_at: processedAt,
      updated_at: processedAt,
    };
  }

  return {
    status: "idle",
    status_message: "Resume requested via NCS control queue.",
    is_paused: false,
    paused_at: null,
    updated_at: processedAt,
  };
};

const selectUpdatedWorker = async (
  supabase: SupabaseClient,
  column: "id" | "worker_key",
  workerId: string,
  patch: Record<string, unknown>
) => {
  const { data, error } = await supabase
    .from("ncs_workers")
    .update(patch)
    .eq(column, workerId)
    .select("id, worker_key, name, status, is_paused, paused_at, updated_at");

  if (error) {
    throw new Error(`Failed to update ncs_workers using ${column}: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return data[0] as UpdatedWorkerRow;
};

const updateWorkerControlState = async (
  supabase: SupabaseClient,
  message: NcsControlQueueMessage,
  processedAt: string
) => {
  const patch = buildWorkerPatch(message.action, processedAt);

  const updatedById = await selectUpdatedWorker(supabase, "id", message.workerId, patch);
  if (updatedById) {
    return updatedById;
  }

  return selectUpdatedWorker(supabase, "worker_key", message.workerId, patch);
};

export const consumeNcsControlBatch = async (
  batch: QueueBatchLike<unknown>,
  env: NcsSupabaseEnv
) => {
  let supabase: SupabaseClient | null = null;

  const getSupabase = () => {
    if (!supabase) {
      supabase = createSupabaseServerClient(env);
    }

    return supabase;
  };

  // Acknowledge each message independently so one bad control message does not force
  // the whole batch to be replayed after earlier updates have already been applied.
  for (const message of batch.messages) {
    const parsedMessage = parseControlQueueMessage(message.body);

    if (!parsedMessage) {
      console.error("Discarding malformed NCS control queue message", {
        queueMessageId: message.id,
        attempts: message.attempts ?? 1,
        body: message.body,
      });
      message.ack();
      continue;
    }

    try {
      const processedAt = new Date().toISOString();
      const updatedWorker = await updateWorkerControlState(
        getSupabase(),
        parsedMessage,
        processedAt
      );

      if (!updatedWorker) {
        console.warn("NCS control queue message targeted an unknown worker", {
          queueMessageId: message.id,
          requestId: parsedMessage.requestId,
          workerId: parsedMessage.workerId,
          action: parsedMessage.action,
        });
        message.ack();
        continue;
      }

      console.log("Processed NCS control queue message", {
        queueMessageId: message.id,
        requestId: parsedMessage.requestId,
        workerId: updatedWorker.id,
        workerKey: updatedWorker.worker_key ?? null,
        workerName: updatedWorker.name ?? null,
        action: parsedMessage.action,
        status: updatedWorker.status ?? null,
        isPaused: updatedWorker.is_paused ?? null,
        pausedAt: updatedWorker.paused_at ?? null,
        updatedAt: updatedWorker.updated_at ?? null,
      });

      message.ack();
    } catch (error) {
      console.error("Failed to process NCS control queue message", {
        queueMessageId: message.id,
        requestId: parsedMessage.requestId,
        workerId: parsedMessage.workerId,
        action: parsedMessage.action,
        attempts: message.attempts ?? 1,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry({
        delaySeconds: CONTROL_RETRY_DELAY_SECONDS,
      });
    }
  }
};

const consumer = {
  async queue(batch: QueueBatchLike<unknown>, env: NcsSupabaseEnv): Promise<void> {
    await consumeNcsControlBatch(batch, env);
  },
};

export default consumer;
