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

export const onRequestOptions = optionsResponse;

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: TradingEnv;
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
