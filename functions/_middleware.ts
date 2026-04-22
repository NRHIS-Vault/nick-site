import {
  classifyHttpOutcome,
  createLogger,
  getLatencyMs,
  getLogLevelForHttpStatus,
  getRequestLocation,
  serializeError,
  type AnalyticsEngineDatasetLike,
  type LoggerEnv,
  writeUsageMetric,
} from "../src/lib/logger";

type MiddlewareEnv = LoggerEnv & {
  WORKER_ANALYTICS?: AnalyticsEngineDatasetLike;
};

type MiddlewareContext = {
  env: MiddlewareEnv;
  functionPath: string;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
  request: Request;
  waitUntil(promise: Promise<unknown>): void;
};

const SERVICE_NAME = "nick-site-pages";
const STATIC_ASSET_PATTERN =
  /\.(?:avif|css|gif|ico|jpg|jpeg|js|map|mjs|png|svg|txt|webp|woff2?|xml)$/i;

const shouldInstrumentRequest = (request: Request) => {
  const url = new URL(request.url);

  return request.method !== "OPTIONS" && !STATIC_ASSET_PATTERN.test(url.pathname);
};

export const onRequest = async (context: MiddlewareContext) => {
  if (!shouldInstrumentRequest(context.request)) {
    return context.next();
  }

  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const url = new URL(context.request.url);
  const operation = context.functionPath || url.pathname;
  const location = getRequestLocation(context.request);
  const logger = createLogger({
    service: SERVICE_NAME,
    env: context.env,
    waitUntil: context.waitUntil,
    defaults: {
      requestId,
      method: context.request.method,
      path: url.pathname,
      host: url.host,
      functionPath: context.functionPath,
      location,
    },
  });

  logger.info("Incoming request");

  try {
    const response = await context.next();
    const latencyMs = getLatencyMs(startedAt);
    const outcome = classifyHttpOutcome(response.status);
    const logLevel = getLogLevelForHttpStatus(response.status);

    logger[logLevel]("Request completed", {
      latencyMs,
      outcome,
      status: response.status,
    });

    writeUsageMetric(context.env.WORKER_ANALYTICS, {
      eventType: "http_request",
      service: SERVICE_NAME,
      operation,
      action: context.request.method,
      outcome,
      status: String(response.status),
      source: url.host,
      location,
      latencyMs,
      isError: response.status >= 500,
    });

    return response;
  } catch (error) {
    const latencyMs = getLatencyMs(startedAt);

    logger.error("Unhandled request error", {
      latencyMs,
      outcome: "exception",
      status: 500,
      error: serializeError(error),
    });

    writeUsageMetric(context.env.WORKER_ANALYTICS, {
      eventType: "http_request",
      service: SERVICE_NAME,
      operation,
      action: context.request.method,
      outcome: "exception",
      status: "500",
      source: url.host,
      location,
      latencyMs,
      isError: true,
    });

    throw error;
  }
};
