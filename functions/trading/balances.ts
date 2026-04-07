import {
  createExchangeClient,
  exchangeErrorResponse,
  jsonResponse,
  optionsResponse,
  type TradingEnv,
} from "./shared";

export const onRequestOptions = optionsResponse;

export const onRequestGet = async ({ env }: { env: TradingEnv }) => {
  try {
    // Initialize a signed ccxt client from server-side secrets such as BINANCE_API_KEY
    // and BINANCE_SECRET. These secrets are read from the Cloudflare Pages `env` object.
    const { exchange, exchangeId } = createExchangeClient(env);

    // Private account API call: ccxt normalizes the exchange balance endpoint.
    // For Binance spot, this signs and calls the account balance endpoint behind fetchBalance().
    const balances = await exchange.fetchBalance();

    return jsonResponse({
      ok: true,
      exchange: exchangeId,
      balances,
    });
  } catch (error) {
    return exchangeErrorResponse(error);
  }
};
