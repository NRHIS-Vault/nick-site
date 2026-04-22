export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type LoggerEnv = {
  LOG_LEVEL?: string;
  LOG_DRAIN_URL?: string;
  LOG_DRAIN_TOKEN?: string;
};

export type AnalyticsEngineDatasetLike = {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: string[];
    doubles?: number[];
  }): void;
};

export type LogEntry = {
  level: LogLevel;
  message: string;
  service: string;
  timestamp: string;
  context: LogContext;
};

export type UsageMetricInput = {
  eventType: string;
  service: string;
  operation: string;
  action: string;
  outcome: string;
  status: string;
  source: string;
  location?: string | null;
  latencyMs?: number | null;
  isError?: boolean;
};

type LoggerOptions = {
  service: string;
  env?: LoggerEnv;
  defaults?: LogContext;
  waitUntil?: (promise: Promise<unknown>) => void;
  transport?: ((entry: LogEntry) => Promise<void>) | null;
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 25;
const MAX_OBJECT_KEYS = 50;

const normalizeLogLevel = (value: string | undefined): LogLevel => {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized;
  }

  return "info";
};

const normalizeValue = (
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (value instanceof Headers) {
    return Object.fromEntries(value.entries());
  }

  if (value instanceof Request) {
    return {
      method: value.method,
      url: value.url,
    };
  }

  if (value instanceof Response) {
    return {
      ok: value.ok,
      redirected: value.redirected,
      status: value.status,
      url: value.url,
    };
  }

  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeValue(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      return "[Circular]";
    }

    seen.add(value as object);

    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      MAX_OBJECT_KEYS
    );

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [
        key,
        normalizeValue(entryValue, depth + 1, seen),
      ])
    );
  }

  return String(value);
};

const normalizeContext = (context: LogContext): LogContext =>
  Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, normalizeValue(value)])
  );

const getConsoleMethod = (level: LogLevel) => {
  if (level === "debug" && typeof console.debug === "function") {
    return console.debug.bind(console);
  }

  if (level === "warn") {
    return console.warn.bind(console);
  }

  if (level === "error") {
    return console.error.bind(console);
  }

  return console.log.bind(console);
};

const createHttpLogDrainTransport = (
  env?: LoggerEnv
): ((entry: LogEntry) => Promise<void>) | null => {
  const endpoint = env?.LOG_DRAIN_URL?.trim();
  if (!endpoint) {
    return null;
  }

  const token = env.LOG_DRAIN_TOKEN?.trim();

  return async (entry: LogEntry) => {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(entry),
    });
  };
};

const emitLog = (
  entry: LogEntry,
  minLevel: LogLevel,
  waitUntil?: (promise: Promise<unknown>) => void,
  transport?: ((entry: LogEntry) => Promise<void>) | null
) => {
  if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[minLevel]) {
    return;
  }

  getConsoleMethod(entry.level)(`[${entry.service}] ${entry.message}`, entry.context);

  if (!transport) {
    return;
  }

  const transportTask = transport(entry).catch((error) => {
    console.warn("[logger] Failed to forward log entry", serializeError(error));
  });

  if (waitUntil) {
    waitUntil(transportTask);
  }
};

// This utility keeps worker-side logging in one place:
// - console output stays structured and consistent across Pages Functions and Workers
// - optional HTTP forwarding can mirror logs to an external collector
// - the same file exposes Analytics Engine helpers so request and queue metrics use a
//   stable column order when queried later
export const createLogger = ({
  service,
  env,
  defaults = {},
  waitUntil,
  transport,
}: LoggerOptions) => {
  const minLevel = normalizeLogLevel(env?.LOG_LEVEL);
  const resolvedTransport = transport ?? createHttpLogDrainTransport(env);

  const write = (level: LogLevel, message: string, context: LogContext = {}) => {
    emitLog(
      {
        level,
        message,
        service,
        timestamp: new Date().toISOString(),
        context: normalizeContext({
          ...defaults,
          ...context,
        }),
      },
      minLevel,
      waitUntil,
      resolvedTransport
    );
  };

  return {
    child: (childDefaults: LogContext) =>
      createLogger({
        service,
        env,
        waitUntil,
        transport: resolvedTransport,
        defaults: {
          ...defaults,
          ...childDefaults,
        },
      }),
    debug: (message: string, context?: LogContext) => write("debug", message, context),
    info: (message: string, context?: LogContext) => write("info", message, context),
    log: (message: string, context?: LogContext) => write("info", message, context),
    warn: (message: string, context?: LogContext) => write("warn", message, context),
    error: (message: string, context?: LogContext) => write("error", message, context),
  };
};

export const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === "string" ? error : String(error),
  };
};

export const classifyHttpOutcome = (status: number) => {
  if (status >= 500) {
    return "server_error";
  }

  if (status >= 400) {
    return "client_error";
  }

  return "success";
};

export const getLogLevelForHttpStatus = (status: number): LogLevel => {
  if (status >= 500) {
    return "error";
  }

  if (status >= 400) {
    return "warn";
  }

  return "info";
};

export const getLatencyMs = (startedAt: number) =>
  Math.round((performance.now() - startedAt) * 100) / 100;

export const getRequestLocation = (request: Request) => {
  const requestWithCf = request as Request & {
    cf?: {
      colo?: string;
      country?: string;
    };
  };

  const colo = requestWithCf.cf?.colo?.trim();
  const country = requestWithCf.cf?.country?.trim();

  return [colo, country].filter(Boolean).join("/") || "unknown";
};

// Column order is fixed so Analytics Engine queries stay predictable:
// - index1  = "<service>:<operation>"
// - blob1   = event type (`http_request`, `queue_message`, ...)
// - blob2   = service
// - blob3   = operation / route
// - blob4   = action / method
// - blob5   = outcome
// - blob6   = status / reason
// - blob7   = source host / queue name
// - blob8   = location
// - double1 = count (always 1)
// - double2 = latency in milliseconds
// - double3 = error flag (1 or 0)
export const writeUsageMetric = (
  dataset: AnalyticsEngineDatasetLike | undefined,
  metric: UsageMetricInput
) => {
  if (!dataset) {
    return;
  }

  dataset.writeDataPoint({
    indexes: [`${metric.service}:${metric.operation}`],
    blobs: [
      metric.eventType,
      metric.service,
      metric.operation,
      metric.action,
      metric.outcome,
      metric.status,
      metric.source,
      metric.location?.trim() || "unknown",
    ],
    doubles: [
      1,
      metric.latencyMs ?? 0,
      metric.isError ? 1 : 0,
    ],
  });
};
