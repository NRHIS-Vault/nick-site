import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./stream";

type ParsedSseEvent = {
  event: string;
  data: unknown;
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  sentMessages: string[] = [];
  private closed = false;
  private listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(message: string) {
    this.sentMessages.push(message);
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.emit("close");
  }

  emit(type: string, data?: unknown) {
    this.listeners.get(type)?.forEach((listener) => listener({ data }));
  }
}

const parseSseBody = (rawBody: string): ParsedSseEvent[] =>
  rawBody
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      let event = "message";
      const dataLines: string[] = [];

      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      return {
        event,
        data: JSON.parse(dataLines.join("\n")),
      };
    });

describe("trading stream worker", () => {
  afterEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes Binance websocket market events into SSE updates", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const abortController = new AbortController();
    const response = await onRequestGet({
      request: new Request(
        "https://example.com/trading/stream?providers=binance&symbols=BTC/USDT",
        {
          signal: abortController.signal,
        }
      ),
      env: {},
    });

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const bodyPromise = response.text();
    const marketSocket = MockWebSocket.instances[0];

    expect(marketSocket?.url).toContain("btcusdt@trade");
    expect(marketSocket?.url).toContain("btcusdt@ticker");

    marketSocket.emit("open");
    marketSocket.emit(
      "message",
      JSON.stringify({
        stream: "btcusdt@ticker",
        data: {
          e: "24hrTicker",
          s: "BTCUSDT",
          c: "68450.10",
          P: "2.45",
          b: "68440.00",
          a: "68460.00",
          E: 1_710_000_000_000,
        },
      })
    );
    marketSocket.emit(
      "message",
      JSON.stringify({
        stream: "btcusdt@trade",
        data: {
          e: "trade",
          s: "BTCUSDT",
          t: 77,
          p: "68455.00",
          q: "0.125",
          T: 1_710_000_001_000,
          m: false,
        },
      })
    );

    abortController.abort();

    const events = parseSseBody(await bodyPromise);
    const signalEvent = events.find((event) => event.event === "signal");
    const tradeEvent = events.find((event) => event.event === "trade");
    const accountStatusEvent = events.find(
      (event) =>
        event.event === "provider-status" &&
        (event.data as { scope?: string }).scope === "account"
    );

    expect(signalEvent?.data).toMatchObject({
      pair: "BTC/USDT",
      exchange: "Binance",
      provider: "binance",
      direction: "UP",
    });
    expect(tradeEvent?.data).toMatchObject({
      pair: "BTC/USDT",
      exchange: "Binance",
      provider: "binance",
      type: "BUY",
      amount: 0.125,
    });
    expect(accountStatusEvent?.data).toMatchObject({
      provider: "binance",
      scope: "account",
      status: "disconnected",
    });
  });
});
