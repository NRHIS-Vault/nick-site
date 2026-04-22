import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  parseControlQueueMessage,
  type NcsControlAction,
  type NcsControlQueueMessage,
  type NcsSupabaseEnv,
} from "./shared";
import {
  createLogger,
  getLatencyMs,
  serializeError,
  type AnalyticsEngineDatasetLike,
  type LoggerEnv,
  writeUsageMetric,
} from "../../src/lib/logger";

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

type QueueExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type NcsConsumerEnv = NcsSupabaseEnv &
  LoggerEnv & {
    WORKER_ANALYTICS?: AnalyticsEngineDatasetLike;
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
const SERVICE_NAME = "ncs-control-consumer";
const QUEUE_NAME = "ncs-control-queue";

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
  env: NcsConsumerEnv,
  executionContext?: QueueExecutionContextLike
) => {
  let supabase: SupabaseClient | null = null;
  const logger = createLogger({
    service: SERVICE_NAME,
    env,
    waitUntil: executionContext
      ? executionContext.waitUntil.bind(executionContext)
      : undefined,
    defaults: {
      batchSize: batch.messages.length,
      queue: QUEUE_NAME,
    },
  });

  const getSupabase = () => {
    if (!supabase) {
      supabase = createSupabaseServerClient(env);
    }

    return supabase;
  };

  logger.info("Received NCS control queue batch");

  // Acknowledge each message independently so one bad control message does not force
  // the whole batch to be replayed after earlier updates have already been applied.
  for (const message of batch.messages) {
    const startedAt = performance.now();
    const messageLogger = logger.child({
      attempts: message.attempts ?? 1,
      queueMessageId: message.id,
    });
    const parsedMessage = parseControlQueueMessage(message.body);

    if (!parsedMessage) {
      const latencyMs = getLatencyMs(startedAt);

      messageLogger.error("Discarding malformed NCS control queue message", {
        body: message.body,
        latencyMs,
      });
      writeUsageMetric(env.WORKER_ANALYTICS, {
        eventType: "queue_message",
        service: SERVICE_NAME,
        operation: QUEUE_NAME,
        action: "invalid",
        outcome: "ignored",
        status: "malformed",
        source: QUEUE_NAME,
        location: "worker",
        latencyMs,
        isError: true,
      });
      message.ack();
      continue;
    }

    const requestedAtMillis = Date.parse(parsedMessage.requestedAt);
    const queueLagMs = Number.isNaN(requestedAtMillis)
      ? null
      : Math.max(0, Date.now() - requestedAtMillis);
    const parsedMessageLogger = messageLogger.child({
      action: parsedMessage.action,
      queueLagMs,
      requestId: parsedMessage.requestId,
      source: parsedMessage.source,
      workerId: parsedMessage.workerId,
    });

    try {
      const processedAt = new Date().toISOString();
      const updatedWorker = await updateWorkerControlState(
        getSupabase(),
        parsedMessage,
        processedAt
      );

      if (!updatedWorker) {
        const latencyMs = getLatencyMs(startedAt);

        parsedMessageLogger.warn("NCS control queue message targeted an unknown worker", {
          latencyMs,
        });
        writeUsageMetric(env.WORKER_ANALYTICS, {
          eventType: "queue_message",
          service: SERVICE_NAME,
          operation: QUEUE_NAME,
          action: parsedMessage.action,
          outcome: "ignored",
          status: "unknown_worker",
          source: QUEUE_NAME,
          location: "worker",
          latencyMs,
          isError: false,
        });
        message.ack();
        continue;
      }

      const latencyMs = getLatencyMs(startedAt);

      parsedMessageLogger.info("Processed NCS control queue message", {
        workerId: updatedWorker.id,
        workerKey: updatedWorker.worker_key ?? null,
        workerName: updatedWorker.name ?? null,
        status: updatedWorker.status ?? null,
        isPaused: updatedWorker.is_paused ?? null,
        pausedAt: updatedWorker.paused_at ?? null,
        updatedAt: updatedWorker.updated_at ?? null,
        latencyMs,
      });
      writeUsageMetric(env.WORKER_ANALYTICS, {
        eventType: "queue_message",
        service: SERVICE_NAME,
        operation: QUEUE_NAME,
        action: parsedMessage.action,
        outcome: "success",
        status: updatedWorker.status ?? "unknown",
        source: QUEUE_NAME,
        location: "worker",
        latencyMs,
        isError: false,
      });

      message.ack();
    } catch (error) {
      const latencyMs = getLatencyMs(startedAt);

      parsedMessageLogger.error("Failed to process NCS control queue message", {
        error: serializeError(error),
        latencyMs,
      });
      writeUsageMetric(env.WORKER_ANALYTICS, {
        eventType: "queue_message",
        service: SERVICE_NAME,
        operation: QUEUE_NAME,
        action: parsedMessage.action,
        outcome: "retry",
        status: "processing_failed",
        source: QUEUE_NAME,
        location: "worker",
        latencyMs,
        isError: true,
      });
      message.retry({
        delaySeconds: CONTROL_RETRY_DELAY_SECONDS,
      });
    }
  }
};

const consumer = {
  async queue(
    batch: QueueBatchLike<unknown>,
    env: NcsConsumerEnv,
    ctx: QueueExecutionContextLike
  ): Promise<void> {
    await consumeNcsControlBatch(batch, env, ctx);
  },
};

export default consumer;
