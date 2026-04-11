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

const findSseEvent = (
  events: ParsedSseEvent[],
  predicate: (event: ParsedSseEvent) => boolean
) => events.find(predicate)?.data;

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
    const signalEvent = findSseEvent(events, (event) => event.event === "signal");
    const tradeEvent = findSseEvent(events, (event) => event.event === "trade");
    const accountStatusEvent = findSseEvent(
      events,
      (event) =>
        event.event === "provider-status" &&
        (event.data as { scope?: string }).scope === "account"
    );

    expect(signalEvent).toMatchObject({
      pair: "BTC/USDT",
      exchange: "Binance",
      provider: "binance",
      direction: "UP",
    });
    expect(tradeEvent).toMatchObject({
      pair: "BTC/USDT",
      exchange: "Binance",
      provider: "binance",
      type: "BUY",
      amount: 0.125,
    });
    expect(accountStatusEvent).toMatchObject({
      provider: "binance",
      scope: "account",
      status: "disconnected",
    });
  });

  it("emits Binance account balance and execution events over SSE", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/api/v3/userDataStream") && method === "POST") {
          return new Response(JSON.stringify({ listenKey: "listen-key-1" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }

        if (url.includes("listenKey=listen-key-1") && method === "DELETE") {
          return new Response(null, { status: 200 });
        }

        throw new Error(`Unexpected fetch ${method} ${url}`);
      }
    );

    vi.stubGlobal("fetch", fetchMock);

    const abortController = new AbortController();
    const response = await onRequestGet({
      request: new Request(
        "https://example.com/trading/stream?providers=binance&symbols=BTC/USDT",
        {
          signal: abortController.signal,
        }
      ),
      env: {
        BINANCE_API_KEY: "binance-key",
      },
    });

    const bodyPromise = response.text();

    // Wait for both upstream sockets: the market stream plus the private listen-key socket.
    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    const [marketSocket, accountSocket] = MockWebSocket.instances;

    expect(marketSocket?.url).toContain("btcusdt@trade");
    expect(accountSocket?.url).toContain("/ws/listen-key-1");

    marketSocket.emit("open");
    accountSocket.emit("open");
    accountSocket.emit(
      "message",
      JSON.stringify({
        e: "outboundAccountPosition",
        u: 1_710_000_002_000,
        B: [
          {
            a: "USDT",
            f: "1250.5",
            l: "49.5",
          },
        ],
      })
    );
    accountSocket.emit(
      "message",
      JSON.stringify({
        e: "executionReport",
        s: "BTCUSDT",
        i: 101,
        I: 7,
        S: "SELL",
        X: "FILLED",
        q: "0.20",
        z: "0.20",
        p: "68510.00",
        L: "68500.00",
        Z: "13700.00",
        T: 1_710_000_002_500,
        n: "4.10",
      })
    );

    abortController.abort();

    const events = parseSseBody(await bodyPromise);
    const accountStatusEvent = findSseEvent(
      events,
      (event) =>
        event.event === "provider-status" &&
        (event.data as { scope?: string; status?: string }).scope === "account" &&
        (event.data as { scope?: string; status?: string }).status === "connected"
    );
    const balanceEvent = findSseEvent(events, (event) => event.event === "balance");
    const tradeEvent = findSseEvent(
      events,
      (event) =>
        event.event === "trade" &&
        String((event.data as { id?: string }).id || "").startsWith("binance:execution:")
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.binance.com/api/v3/userDataStream",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-MBX-APIKEY": "binance-key",
        },
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.binance.com/api/v3/userDataStream?listenKey=listen-key-1",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          "X-MBX-APIKEY": "binance-key",
        },
      })
    );
    expect(accountStatusEvent).toMatchObject({
      provider: "binance",
      scope: "account",
      status: "connected",
    });
    expect(balanceEvent).toMatchObject({
      exchange: "Binance",
      provider: "binance",
      asset: "USDT",
      totalBalance: 1300,
      availableBalance: 1250.5,
      lockedBalance: 49.5,
    });
    expect(tradeEvent).toMatchObject({
      pair: "BTC/USDT",
      exchange: "Binance",
      provider: "binance",
      type: "SELL",
      amount: 0.2,
      price: 68500,
      marketPrice: 68500,
      fee: 4.1,
      status: "CLOSED",
    });
  });
});
