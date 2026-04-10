import {
  createExchangeClient,
  exchangeErrorResponse,
  getOptionalLimit,
  getOptionalSince,
  getOptionalSymbol,
  jsonResponse,
  optionsResponse,
  type TradingEnv,
} from "./shared";
import {
  TradingAuthorizationError,
  type TradingActionAuthEnv,
  requireTradingActionRole,
} from "./auth";

export const onRequestOptions = optionsResponse;

type TradingOrdersEnv = TradingEnv & TradingActionAuthEnv;

type CreateOrderSide = "buy" | "sell";
type CreateOrderType = "market" | "limit";

type CreateOrderPayload = {
  symbol: string;
  side: CreateOrderSide;
  type: CreateOrderType;
  amount: number;
  price?: number;
};

type CancelOrderPayload = {
  orderId: string;
  symbol?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readTrimmedString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const parsePositiveNumber = (value: unknown, fieldName: string) => {
  const parsedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return parsedValue;
};

const readJsonBody = async (request: Request) => {
  try {
    return await request.json();
  } catch (_error) {
    throw new Error("Invalid JSON body.");
  }
};

const parseCreateOrderPayload = (payload: unknown): CreateOrderPayload => {
  if (!isRecord(payload)) {
    throw new Error("Request body must be a JSON object.");
  }

  const symbol = readTrimmedString(payload.symbol).toUpperCase();
  const rawSide = readTrimmedString(payload.side).toLowerCase();
  const rawType = readTrimmedString(payload.type || "market").toLowerCase();

  if (!symbol) {
    throw new Error("symbol is required.");
  }

  if (rawSide !== "buy" && rawSide !== "sell") {
    throw new Error("side must be BUY or SELL.");
  }

  if (rawType !== "market" && rawType !== "limit") {
    throw new Error("type must be MARKET or LIMIT.");
  }

  const amount = parsePositiveNumber(payload.amount, "amount");
  const price =
    payload.price === undefined || payload.price === null
      ? undefined
      : parsePositiveNumber(payload.price, "price");

  if (rawType === "limit" && price === undefined) {
    throw new Error("price is required for limit orders.");
  }

  return {
    symbol,
    side: rawSide,
    type: rawType,
    amount,
    price,
  };
};

const parseCancelOrderPayload = (payload: unknown): CancelOrderPayload => {
  if (!isRecord(payload)) {
    throw new Error("Request body must be a JSON object.");
  }

  const orderId = readTrimmedString(payload.orderId);
  const symbol = readTrimmedString(payload.symbol).toUpperCase() || undefined;

  if (!orderId) {
    throw new Error("orderId is required.");
  }

  return {
    orderId,
    symbol,
  };
};

const requestErrorResponse = (message: string) =>
  jsonResponse(
    {
      ok: false,
      code: "TRADING_ACTION_BAD_REQUEST",
      error: message,
    },
    400
  );

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: TradingOrdersEnv;
}) => {
  try {
    const symbol = getOptionalSymbol(request, env);
    const since = getOptionalSince(request);
    const limit = getOptionalLimit(request, env);

    // Initialize a signed ccxt client from server-side secrets such as BINANCE_API_KEY
    // and BINANCE_SECRET. These secrets are read from the Cloudflare Pages `env` object.
    const { exchange, exchangeId } = createExchangeClient(env);

    // Private orders API call: ccxt normalizes the exchange open-order endpoint.
    // For Binance spot, this signs and calls the open orders endpoint behind fetchOpenOrders().
    const orders = await exchange.fetchOpenOrders(symbol, since, limit);

    return jsonResponse({
      ok: true,
      exchange: exchangeId,
      symbol: symbol ?? null,
      count: orders.length,
      orders,
    });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
};

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: TradingOrdersEnv;
}) => {
  try {
    // Risk control: reject unauthorized users before the worker instantiates the exchange client
    // or signs any outbound mutation request with live API credentials.
    const { role, user } = await requireTradingActionRole(request, env);
    const payload = parseCreateOrderPayload(await readJsonBody(request));
    const { exchange, exchangeId } = createExchangeClient(env);
    const order = await exchange.createOrder(
      payload.symbol,
      payload.type,
      payload.side,
      payload.amount,
      payload.price
    );

    return jsonResponse({
      ok: true,
      action: "create",
      exchange: exchangeId,
      symbol: payload.symbol,
      side: payload.side.toUpperCase(),
      type: payload.type.toUpperCase(),
      amount: payload.amount,
      price: payload.price ?? null,
      order,
      executedBy: {
        userId: user.id,
        role,
      },
    });
  } catch (error) {
    if (error instanceof TradingAuthorizationError) {
      return jsonResponse(
        {
          ok: false,
          code: error.code,
          error: error.message,
        },
        error.status
      );
    }

    if (error instanceof Error && error.message) {
      const requestErrors = new Set([
        "Invalid JSON body.",
        "Request body must be a JSON object.",
        "symbol is required.",
        "side must be BUY or SELL.",
        "type must be MARKET or LIMIT.",
        "price is required for limit orders.",
        "amount must be a positive number.",
        "price must be a positive number.",
      ]);

      if (requestErrors.has(error.message)) {
        return requestErrorResponse(error.message);
      }
    }

    return exchangeErrorResponse(error);
  }
};

export const onRequestDelete = async ({
  request,
  env,
}: {
  request: Request;
  env: TradingOrdersEnv;
}) => {
  try {
    // Risk control: cancellation is also an exchange mutation, so the same role gate applies
    // even when the user already has general dashboard access.
    const { role, user } = await requireTradingActionRole(request, env);
    const payload = parseCancelOrderPayload(await readJsonBody(request));
    const { exchange, exchangeId } = createExchangeClient(env);
    const order = await exchange.cancelOrder(payload.orderId, payload.symbol);

    return jsonResponse({
      ok: true,
      action: "cancel",
      exchange: exchangeId,
      orderId: payload.orderId,
      symbol: payload.symbol ?? null,
      order,
      executedBy: {
        userId: user.id,
        role,
      },
    });
  } catch (error) {
    if (error instanceof TradingAuthorizationError) {
      return jsonResponse(
        {
          ok: false,
          code: error.code,
          error: error.message,
        },
        error.status
      );
    }

    if (error instanceof Error && error.message) {
      const requestErrors = new Set([
        "Invalid JSON body.",
        "Request body must be a JSON object.",
        "orderId is required.",
      ]);

      if (requestErrors.has(error.message)) {
        return requestErrorResponse(error.message);
      }
    }

    return exchangeErrorResponse(error);
  }
};
