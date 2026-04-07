import {
  createExchangeClient,
  exchangeErrorResponse,
  getOptionalLimit,
  getOptionalSince,
  getOptionalSymbol,
  jsonResponse,
  optionsResponse,
  requireSymbol,
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
    const symbol = requireSymbol(getOptionalSymbol(request, env));
    const since = getOptionalSince(request);
    const limit = getOptionalLimit(request, env);

    // Initialize a signed ccxt client from server-side secrets such as BINANCE_API_KEY
    // and BINANCE_SECRET. These secrets are read from the Cloudflare Pages `env` object.
    const { exchange, exchangeId } = createExchangeClient(env);

    // Private trade-history API call: ccxt normalizes the exchange account-trades endpoint.
    // For Binance spot, this signs and calls the account trade history endpoint behind fetchMyTrades().
    const trades = await exchange.fetchMyTrades(symbol, since, limit);

    return jsonResponse({
      ok: true,
      exchange: exchangeId,
      symbol,
      since: since ?? null,
      limit,
      count: trades.length,
      trades,
    });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
};
