import { beforeEach, describe, expect, it, vi } from "vitest";

import { onRequest } from "./_middleware";

describe("observability middleware", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    consoleLogSpy.mockClear();
    consoleWarnSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it("logs request lifecycle details and writes Analytics Engine usage metrics", async () => {
    const analytics = {
      writeDataPoint: vi.fn(),
    };
    const context = {
      env: {
        WORKER_ANALYTICS: analytics,
      },
      functionPath: "/contact",
      next: vi.fn().mockResolvedValue(new Response("ok", { status: 202 })),
      request: new Request("https://example.com/contact", {
        method: "POST",
      }),
      waitUntil: vi.fn(),
    };

    const response = await onRequest(context);

    expect(response.status).toBe(202);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[nick-site-pages] Incoming request",
      expect.objectContaining({
        functionPath: "/contact",
        host: "example.com",
        method: "POST",
        path: "/contact",
        requestId: expect.any(String),
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[nick-site-pages] Request completed",
      expect.objectContaining({
        latencyMs: expect.any(Number),
        outcome: "success",
        status: 202,
      })
    );
    expect(analytics.writeDataPoint).toHaveBeenCalledWith({
      indexes: ["nick-site-pages:/contact"],
      blobs: [
        "http_request",
        "nick-site-pages",
        "/contact",
        "POST",
        "success",
        "202",
        "example.com",
        "unknown",
      ],
      doubles: [1, expect.any(Number), 0],
    });
  });

  it("logs unhandled errors and records them as failed usage metrics", async () => {
    const analytics = {
      writeDataPoint: vi.fn(),
    };
    const context = {
      env: {
        WORKER_ANALYTICS: analytics,
      },
      functionPath: "/chat",
      next: vi.fn().mockRejectedValue(new Error("boom")),
      request: new Request("https://example.com/chat", {
        method: "POST",
      }),
      waitUntil: vi.fn(),
    };

    await expect(onRequest(context)).rejects.toThrow("boom");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[nick-site-pages] Unhandled request error",
      expect.objectContaining({
        error: expect.objectContaining({
          message: "boom",
          name: "Error",
        }),
        outcome: "exception",
        status: 500,
      })
    );
    expect(analytics.writeDataPoint).toHaveBeenCalledWith({
      indexes: ["nick-site-pages:/chat"],
      blobs: [
        "http_request",
        "nick-site-pages",
        "/chat",
        "POST",
        "exception",
        "500",
        "example.com",
        "unknown",
      ],
      doubles: [1, expect.any(Number), 1],
    });
  });
});
